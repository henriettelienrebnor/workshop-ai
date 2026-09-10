import { maskinportenHeader } from "../../digdir-mock/src/client.ts";
import { aktorFor, type Caller } from "./autentisering.ts";
import { aiBaseUrl, eksterneApiVerter, fiksBaseUrl, fiksDialogToken } from "./config.ts";
import { HttpError } from "./errors.ts";
import { runRessurs } from "./ressurser.ts";
import { addRevisjon } from "./revisjon.ts";
import { updateJson } from "../../shared/jsonstore.ts";
import type { Person } from "../../shared/innbyggerdata.ts";
import { buildSoknadsdokument } from "./kvittering.ts";
import { sendKvittering } from "./svarut.ts";
import { findPerson, newId } from "./state.ts";
import { buildAdvarsel, callUpstream, tryUpstream } from "./upstream.ts";
import type {
  ProsessDefinisjon,
  ProsessSteg,
  Prosessoekt,
  SjekkResultat,
  Stegtype,
  State
} from "./types.ts";

function replaceParametere(url: string, oekt: Prosessoekt) {
  let result = url;
  result = result.replace(/{personId}/g, encodeURIComponent(oekt.personId));
  // What an earlier step's response left behind: {resultat.<stegId>.<felt>}. A
  // field that is not there yet stays unsubstituted, so the failing URL still
  // names the placeholder that was never filled.
  result = result.replace(/\{resultat\.([^.}]+)\.([^}]+)\}/g, (mal, stegId, felt) => {
    const verdi = (oekt.resultater?.[stegId] as Record<string, unknown> | undefined)?.[felt];
    return verdi === undefined || verdi === null ? mal : encodeURIComponent(String(verdi));
  });
  for (const [stegId, svarVerdi] of Object.entries(oekt.svar || {})) {
    const enkeltMal = new RegExp(`\\{svar\\.${stegId}\\}`, "g");
    if (typeof svarVerdi === "string") {
      result = result.replace(enkeltMal, encodeURIComponent(svarVerdi));
    }
    if (typeof svarVerdi === "object" && svarVerdi !== null) {
      const felter = Object.entries(svarVerdi);
      for (const [feltId, feltVerdi] of felter) {
        const feltMal = new RegExp(`\\{svar\\.${stegId}\\.${feltId}\\}`, "g");
        result = result.replace(feltMal, encodeURIComponent(String(feltVerdi)));
      }
      // A one-field answer also satisfies the short form {svar.<stegId>}.
      //
      // The two reference clients disagree on shape for the same step: a QUESTION
      // with `felter` makes demo-gui's step-by-step page post an object
      // ({gatenavn: "Storgata"}), while /chat posts the raw string. Without this,
      // `fartsdempende-tiltak` worked in /chat and via curl but left a literal
      // "{svar.velg-gate}" in the URL on localhost:3001 - surfacing as
      // `Fant ikke gaten "{svar.velg-gate}"`, which reads like a typo by the user.
      //
      // Only when there is exactly one field: with several, the short form is
      // genuinely ambiguous and should stay unsubstituted.
      if (felter.length === 1) {
        result = result.replace(enkeltMal, encodeURIComponent(String(felter[0][1])));
      }
    }
  }
  return result;
}

/*
 * The image a step wants shown, resolved before the step leaves the service.
 *
 * `bilde.kilde` is either a data-URL written into the definition, or
 * {resultat.<stegId>.<felt>} - a value an earlier step fetched, such as the QR
 * code the verifier answers with. Resolving it here rather than in each client
 * is what keeps stegvis, chat and the agent showing the same thing: they all
 * read `aktivtSteg`, and three template resolvers would have drifted.
 *
 * Only base64 data-URLs for raster images pass. The value comes from an external
 * response, and a client that renders whatever a step points at would be an
 * injection surface - `javascript:` in an <img> src is the old version of it, and
 * SVG is the current one.
 */
const BILDEMAL = /^\{resultat\.([^.}]+)\.([^}]+)\}$/;
const BILDEDATA = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function medOppslaattBilde(steg: ProsessSteg, oekt: Prosessoekt): ProsessSteg {
  const kilde = steg.bilde?.kilde;
  if (typeof kilde !== "string") return steg;
  const treff = BILDEMAL.exec(kilde);
  const verdi = treff
    ? (oekt.resultater?.[treff[1]] as Record<string, unknown> | undefined)?.[treff[2]]
    : kilde;
  if (typeof verdi !== "string" || !BILDEDATA.test(verdi)) return steg;
  // Kopi: definisjonen i katalogen deles av alle økter og skal ikke bære
  // resultatet fra én av dem.
  return { ...steg, bilde: { ...steg.bilde!, url: verdi } };
}

export function buildProsessoektRespons(oekt: Prosessoekt, prosess: ProsessDefinisjon | null) {
  const steg = prosess?.steg?.[oekt.stegIndex] || null;
  return {
    ...oekt,
    aktivtSteg: steg ? medOppslaattBilde(steg, oekt) : null,
    totaltAntallSteg: prosess?.steg?.length || 0
  };
}

// DATA_FETCH and SJEKK consult the shared resource catalog through the same path
// as the HTTP router, so consent gating and audit cannot diverge between them.
// Unless the step names an absolute URL - then the data lives outside the
// sandbox, and only the allowlist below can be reached.
async function getFraKatalog(tilstand: State, oekt: Prosessoekt, steg: any, kaller: Caller) {
  const resolvedUrl = replaceParametere(steg.api.url, oekt);
  if (/^https?:\/\//i.test(resolvedUrl)) {
    return kallEksterntApi(resolvedUrl, oekt, steg, kaller);
  }
  return runRessurs(tilstand, steg.api.method || "GET", new URL(`http://localhost${resolvedUrl}`), {
    oekt,
    steg,
    sporingsId: oekt.sporingsId,
    kaller
  });
}

const vent = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/*
 * A step against a real, external API.
 *
 * The catalog cannot serve these: it answers from the synthetic datasets on disk,
 * and a service like the eIDAS2 verifier holds state we do not have. So the
 * engine calls it directly - but only over https, and only to a host on
 * `eksterneApiVerter`. Without that check a process definition, which is data
 * anyone at the workshop may edit, could point a step at an internal address and
 * have the backend fetch it with its own network position (SSRF).
 *
 * `polling` exists because some of these calls are asynchronous by nature: the
 * verifier answers WAIT until the citizen has approved the request in their
 * wallet. The step waits for the terminal value rather than the client having to
 * know to run it again.
 */
async function kallEksterntApi(resolvedUrl: string, oekt: Prosessoekt, steg: any, kaller: Caller) {
  const url = new URL(resolvedUrl);
  if (url.protocol !== "https:" || !eksterneApiVerter.includes(url.hostname.toLowerCase())) {
    throw new HttpError(
      `Steget «${steg.id}» peker på ${url.hostname}, som ikke er et tillatt eksternt API.`,
      400,
      { hint: "Legg verten til i EKSTERNE_API_VERTER hvis den skal kunne kalles.", syntetisk: true }
    );
  }

  const method = (steg.api.method || "GET").toUpperCase();
  const kall = { service: "Det eksterne API-et", action: `Å hente data i steget ${steg.id}` };
  const send = () => callUpstream<any>(kall, () => fetch(url, {
    method,
    headers: {
      ...(steg.api.body ? { "Content-Type": "application/json" } : {}),
      ...(steg.api.headers || {})
    },
    ...(steg.api.body ? { body: JSON.stringify(steg.api.body) } : {}),
    signal: AbortSignal.timeout(15000)
  }));

  await addRevisjon({
    sporingsId: oekt.sporingsId,
    handling: "EKSTERNT_API_KALL",
    ressurs: `${url.hostname}${url.pathname}`,
    aktor: aktorFor(kaller, oekt.personId)
  });

  const polling = steg.polling;
  if (!polling) return send();

  const maksForsok = polling.maksForsok || 30;
  const intervallMs = polling.intervallMs || 2000;
  let data: any = null;
  for (let forsok = 0; forsok < maksForsok; forsok++) {
    if (forsok > 0) await vent(intervallMs);
    data = await send();
    if (String(data?.[polling.felt]) === polling.verdi) return data;
  }
  throw new HttpError(
    polling.tidsavbruddMelding ||
      `${polling.felt} ble ikke ${polling.verdi} innen tidsfristen.`,
    504,
    { sisteSvar: data, syntetisk: true }
  );
}

/*
 * The søknad is appended inside the write queue, not pushed onto the request's
 * own copy of the array and written whole. That was a lost update with no queue
 * at all: two SUBMIT at once, and the second writer's array never contained the
 * first søknad - no error, nothing in the log, one citizen's application gone.
 *
 * It takes no State any more, and that is the point: there is no request-scoped
 * copy left for it to write.
 */
export async function createSoknad(
  body: any,
  kaller: Caller,
  /**
   * Set only by the SUBMIT step handler below. Without it - the direct
   * POST /api/soknader route never passes it - the row and the response are
   * byte-identical to before these fields existed.
   *
   * `person` is the masked row readState() handed out, so the recipient this
   * service passes to SvarUt is already the protected one where that applies.
   */
  dokumentInfo?: { dokument: string; person: Person | null }
) {
  const nySoknad = {
    soknadId: newId("soknad"),
    personId: body.personId,
    prosessId: body.prosessId,
    status: "SENDT_INN",
    opprettet: new Date().toISOString(),
    sporingsId: body.sporingsId || newId("flyt"),
    syntetisk: true,
    ...(dokumentInfo ? { soknadsdokument: dokumentInfo.dokument } : {})
  };

  await updateJson("soknader.json", [], (soknader: unknown[]) => {
    soknader.push(nySoknad);
  });
  await addRevisjon({
    sporingsId: nySoknad.sporingsId,
    handling: "SOKNAD_SENDT_INN",
    ressurs: "soknad",
    aktor: aktorFor(kaller, nySoknad.personId)
  });

  /*
   * The Fiks task is best effort: the søknad is already recorded, and the citizen
   * is not made to send it again because a downstream queue is unhappy. But best
   * effort still means *one* way of degrading - tryUpstream's, not a local
   * ok-check.
   */
  const oppgave = await tryUpstream<unknown>(
    { service: "Fiks-simulatoren", action: "Å opprette oppgave" },
    async () => fetch(`${fiksBaseUrl}/fiks/oppgaver`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await maskinportenHeader(fiksDialogToken))
      },
      body: JSON.stringify({
        personId: nySoknad.personId,
        soknadId: nySoknad.soknadId,
        tittel: `Behandle ${body.prosessNavn || "søknad"}`,
        sporingsId: nySoknad.sporingsId
      })
    })
  );

  /*
   * The kvittering is the second best-effort step, and it is deliberately after
   * the task: the caseworker's queue is what the municipality owes itself, the
   * receipt is what it owes the citizen, and neither may cost the other. The
   * channel is not decided here - SvarUt reads KRR on `mottaker.digitalId` and
   * chooses, exactly as the real one does. Everything past the receipt (the
   * vedtaksbrev, the varsling, the further case handling) is still the
   * participants' build surface.
   *
   * `forsendelseId` is written back onto the row in a second pass through the
   * queue rather than held back until the send returns, so a søknad is stored
   * before anything downstream is attempted - and the row keeps no copy of the
   * advarsel: the response says what happened, the row says what exists.
   */
  const kvittering = dokumentInfo
    ? await sendKvittering(dokumentInfo.person, nySoknad.soknadId, body.prosessNavn)
    : null;
  const forsendelseId = kvittering?.ok ? kvittering.svar.id : undefined;
  if (forsendelseId) {
    await updateJson("soknader.json", [], (soknader: any[]) => {
      const rad = soknader.find((kandidat) => kandidat.soknadId === nySoknad.soknadId);
      if (rad) rad.forsendelseId = forsendelseId;
    });
  }

  return {
    ...nySoknad,
    ...(forsendelseId ? { forsendelseId } : {}),
    oppgave: oppgave.ok ? oppgave.data : buildAdvarsel(
      "Oppgaven i Fiks-simulatoren ble ikke opprettet. Søknaden er lagret.",
      oppgave.error.message
    ),
    ...(kvittering ? { forsendelse: kvittering.ok ? kvittering.svar : kvittering.advarsel } : {})
  };
}

type StegContext = {
  tilstand: State;
  oekt: Prosessoekt;
  prosess: ProsessDefinisjon;
  steg: any;
  body: any;
  /** Who is calling, from the token. See autentisering.ts. */
  kaller: Caller;
};

// One handler per step type. A new step type is one entry here; the execution
// below needs no change. Record<Stegtype, ...> makes the compiler demand a
// handler as soon as a new step type is added to types.ts.
export const stegHandlers: Record<Stegtype, (k: StegContext) => unknown | Promise<unknown>> = {
  INFO: () => ({ type: "INFO", melding: "Informasjonssteg krever ingen handling." }),

  QUESTION: ({ oekt, steg, body }) => {
    const svar = body.svar ?? oekt.svar[steg.id];
    if (!svar) {
      throw new HttpError("Spørsmålssteg krever et svar.", 400);
    }
    oekt.svar[steg.id] = svar;
    return { type: "QUESTION", svar };
  },

  CONSENT_REQUEST: async ({ oekt, steg, body, kaller }) => {
    if (body.handling === "opprett-samtykke") {
      const data = await callUpstream<any>(
        { service: "Fiks-simulatoren", action: "Å opprette samtykke", relayStatus: true },
        async () => fetch(`${fiksBaseUrl}/fiks/samtykke`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(await maskinportenHeader(fiksDialogToken))
          },
          body: JSON.stringify({
            personId: oekt.personId,
            formaal: steg.formaal,
            dataKilder: steg.dataKilder || [],
            sporingsId: oekt.sporingsId
          })
        })
      );
      oekt.aktivtSamtykkeId = data.samtykkeId;
      oekt.resultater[steg.id] = data;
      return data;
    }

    if (body.handling === "samtykkesvar") {
      const status = body.status || "SAMTYKKET";
      const samtykkeId = oekt.aktivtSamtykkeId;
      if (!samtykkeId) {
        throw new HttpError("Ingen aktiv samtykkeforespørsel finnes.", 400);
      }
      /*
       * The samtykke routes have a state machine from Del D on, so answering the
       * same request twice, or answering one that was withdrawn, comes back as
       * 409. Fiks's status and melding are passed through unchanged, so the
       * citizen reads what the samtykke service said rather than a paraphrase.
       */
      const data = await callUpstream<any>(
        { service: "Fiks-simulatoren", action: "Å svare på samtykket", relayStatus: true },
        async () => fetch(`${fiksBaseUrl}/fiks/samtykke/${samtykkeId}/svar`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(await maskinportenHeader(fiksDialogToken))
          },
          body: JSON.stringify({
            status,
            sporingsId: oekt.sporingsId,
            // Only this service holds the verified token, so only it can say who
            // agreed. Without this the samtykke event would name fiks-simulator as
            // the actor - honest, but far less useful than the truth.
            aktor: aktorFor(kaller, oekt.personId)
          })
        })
      );
      oekt.resultater[steg.id] = data;
      return data;
    }

    throw new HttpError("Samtykkesteg krever handlingen opprett-samtykke eller samtykkesvar.", 400);
  },

  DATA_FETCH: async ({ tilstand, oekt, steg, kaller }) => {
    const data = await getFraKatalog(tilstand, oekt, steg, kaller);
    oekt.resultater[steg.id] = data;
    return data;
  },

  SJEKK: async ({ tilstand, oekt, steg, kaller }) => {
    const resultat = await getFraKatalog(tilstand, oekt, steg, kaller) as SjekkResultat;

    oekt.resultater[steg.id] = resultat;
    if (!resultat.godkjent) {
      oekt.status = "AVVIST";
      oekt.avvistMelding = resultat.melding;
    }
    await addRevisjon({
      sporingsId: oekt.sporingsId,
      handling: resultat.godkjent ? "SJEKK_OK" : "SJEKK_AVVIST",
      ressurs: "prosessoekt",
      aktor: aktorFor(kaller, oekt.personId)
    });
    return resultat;
  },

  /*
   * The gateway answers 200 with an `advarsel` when the model is unavailable and
   * it falls back to template text, so a failure here means the gateway itself
   * broke. Failing the step leaves the økt on SUMMARY - withSession saves
   * nothing when the handler throws - so a retry is a retry.
   */
  SUMMARY: async ({ oekt, prosess, steg }) => {
    const data = await callUpstream<any>(
      { service: "KI-tjenesten", action: "Å lage oppsummeringen" },
      () => fetch(`${aiBaseUrl}/ai/oppsummering`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sporingsId: oekt.sporingsId,
          kontekst: {
            tjeneste: prosess.navn,
            personId: oekt.personId,
            prosessId: oekt.prosessId,
            data: oekt.resultater,
            svar: oekt.svar
          },
          sprak: "nb"
        })
      })
    );
    oekt.resultater[steg.id] = data;
    return data;
  },

  SUBMIT: async ({ tilstand, oekt, prosess, steg, kaller }) => {
    const person = findPerson(tilstand, oekt.personId);
    const dokument = buildSoknadsdokument(prosess, oekt, person);
    const data = await createSoknad({
      personId: oekt.personId,
      prosessId: oekt.prosessId,
      prosessNavn: prosess.navn,
      sporingsId: oekt.sporingsId
    }, kaller, { dokument, person });
    oekt.resultater[steg.id] = data;
    oekt.status = "FULLFORT";
    return data;
  }
};

export async function runStegHandling(
  tilstand: State,
  oekt: Prosessoekt,
  prosess: ProsessDefinisjon,
  body: any,
  kaller: Caller
) {
  const steg: ProsessSteg | undefined = prosess.steg[oekt.stegIndex];
  if (!steg) {
    throw new HttpError("Fant ikke aktivt steg.", 400);
  }

  const handterer = stegHandlers[steg.type as Stegtype];
  if (!handterer) {
    throw new HttpError(
      `Støtter ikke stegtypen ${steg.type}. Gyldige: ${Object.keys(stegHandlers).join(", ")}.`,
      400
    );
  }

  return handterer({ tilstand, oekt, prosess, steg, body, kaller });
}
