type TiltaksomfangKropp = {
  tekst?: string;
  sporingsId?: string;
  kontekst?: Record<string, unknown>;
  history?: { role?: string; message?: string }[];
};

export type Feltavklaring = { verdi: boolean | null; confidence: number };

export type Vindustiltak = {
  type: "vindusutskifting";
  plassering: { motGate: boolean | null };
  visuelt: {
    storrelseEndres: boolean | null;
    plasseringEndres: boolean | null;
    hovedinndelingEndres: boolean | null;
    fargeEndres: boolean | null;
    nyFarge: string | null;
    materialeEndres: boolean | null;
  };
  konstruksjon: { baerendeKonstruksjonBerort: boolean | null };
};

export type Kravvurdering = {
  bestemmelseId: string;
  kravId: string;
  status: "oppfylt" | "mangler_fakta";
  mangler: string[];
  veiledning: string;
};

export type Tiltaksavklaring = {
  fasadeendring: Feltavklaring;
  endringBaerekonstruksjon: Feltavklaring;
  tiltak?: Vindustiltak;
  kravvurdering?: Kravvurdering[];
  mangler?: string[];
  begrunnelse: string;
  oppfolgingssporsmaal: string | null;
};

type FasadeKjennetegn = {
  id: string;
  label: string;
  endret: string[];
  uendret: string[];
  planord: string[];
};

const TOMT_VINDUSTILTAK: Vindustiltak = {
  type: "vindusutskifting",
  plassering: { motGate: null },
  visuelt: {
    storrelseEndres: null,
    plasseringEndres: null,
    hovedinndelingEndres: null,
    fargeEndres: null,
    nyFarge: null,
    materialeEndres: null
  },
  konstruksjon: { baerendeKonstruksjonBerort: null }
};

const fasadeKjennetegn: FasadeKjennetegn[] = [
  {
    id: "storrelse",
    label: "størrelse",
    endret: ["større", "storre", "mindre", "annen størrelse", "annen storrelse", "ny størrelse", "ny storrelse"],
    uendret: ["samme størrelse", "samme storrelse", "lik størrelse", "lik storrelse", "uendret størrelse", "uendret storrelse", "ikke annen størrelse", "ikke annen storrelse", "ikke endre størrelse", "ikke endre storrelse", "ingen størrelsesendring", "ingen storrelsesendring"],
    planord: ["størrelse", "storrelse", "større", "mindre"]
  },
  {
    id: "form",
    label: "form",
    endret: ["annen form", "ny form", "endre form", "endret form"],
    uendret: ["samme form", "lik form", "uendret form", "ikke endre form", "ingen formendring"],
    planord: ["form", "hovedinndeling", "inndeling"]
  },
  {
    id: "plassering",
    label: "plassering",
    endret: ["annen plassering", "ny plassering", "flytte vinduet", "flyttes", "flytter vinduet"],
    uendret: ["samme plassering", "samme plass", "lik plassering", "uendret plassering"],
    planord: ["plassering", "plass"]
  },
  {
    id: "stil",
    label: "stil og uttrykk",
    endret: ["annen stil", "ny stil", "annen hovedinndeling", "annet uttrykk", "annet visuelt uttrykk"],
    uendret: ["samme stil", "samme hovedinndeling", "samme uttrykk", "lik stil", "likt uttrykk"],
    planord: ["stil", "uttrykk", "visuelle", "hovedinndeling"]
  },
  {
    id: "farge",
    label: "farge",
    endret: ["annen farge", "ny farge", "bytte farge", "endre farge", "male vindu", "malt vindu"],
    uendret: ["samme farge", "lik farge", "uendret farge", "ikke endre farge", "ingen fargeendring"],
    planord: ["farge", "fargebruk"]
  },
  {
    id: "materialbruk",
    label: "materialbruk",
    endret: ["annet materiale", "annen materialbruk", "nye materialer", "nytt materiale"],
    uendret: ["samme materiale", "samme materialbruk", "likt materiale", "uendret materiale"],
    planord: ["materialbruk", "materiale", "materialer"]
  }
];

export const TILTAKSOMFANG_FALLBACK: Tiltaksavklaring = {
  fasadeendring: { verdi: null, confidence: 0 },
  endringBaerekonstruksjon: { verdi: null, confidence: 0 },
  begrunnelse: "Ingen modell tilgjengelig til å tolke svaret.",
  oppfolgingssporsmaal:
    "Kan du beskrive om det nye vinduet får samme størrelse og plassering som det gamle, og om veggen rundt må endres?"
};

function normalizeText(tekst: unknown): string {
  return String(tekst || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(ord: string[], uttrykk: string): boolean {
  const chunks = uttrykk.split(" ");
  for (let i = 0; i <= ord.length - chunks.length; i += 1) {
    if (chunks.every((del, forskyvning) => ord[i + forskyvning] === del)) {
      return true;
    }
  }
  return false;
}

function treff(tekst: string, uttrykk: string[]): boolean {
  const ord = tekst.split(" ").filter(Boolean);
  return uttrykk.some((monster) => containsPhrase(ord, normalizeText(monster)));
}

function tiltaksomfangTekst(body: TiltaksomfangKropp): string {
  const historikk = Array.isArray(body?.history) ? body.history : [];
  return normalizeText([
    ...historikk
      .filter((tur) => tur?.role !== "assistent" && tur?.role !== "assistant")
      .map((tur) => tur?.message || ""),
    body?.tekst || ""
  ].join(" "));
}

function boolEllerNull(verdi: unknown): boolean | null {
  return typeof verdi === "boolean" ? verdi : null;
}

function tekstEllerNull(verdi: unknown): string | null {
  return typeof verdi === "string" && verdi.trim() ? verdi.trim() : null;
}

export function validateVindustiltak(raa: unknown): Vindustiltak | null {
  if (!raa || typeof raa !== "object") return null;
  const data = raa as Record<string, unknown>;
  const plassering = (data.plassering || {}) as Record<string, unknown>;
  const visuelt = (data.visuelt || {}) as Record<string, unknown>;
  const konstruksjon = (data.konstruksjon || {}) as Record<string, unknown>;
  return {
    type: "vindusutskifting",
    plassering: { motGate: boolEllerNull(plassering.motGate) },
    visuelt: {
      storrelseEndres: boolEllerNull(visuelt.storrelseEndres),
      plasseringEndres: boolEllerNull(visuelt.plasseringEndres),
      hovedinndelingEndres: boolEllerNull(visuelt.hovedinndelingEndres),
      fargeEndres: boolEllerNull(visuelt.fargeEndres),
      nyFarge: tekstEllerNull(visuelt.nyFarge),
      materialeEndres: boolEllerNull(visuelt.materialeEndres)
    },
    konstruksjon: { baerendeKonstruksjonBerort: boolEllerNull(konstruksjon.baerendeKonstruksjonBerort) }
  };
}

function validateFeltavklaring(raa: unknown): Feltavklaring | null {
  if (!raa || typeof raa !== "object") return null;
  const data = raa as { verdi?: unknown; confidence?: unknown };
  const verdi = typeof data.verdi === "boolean" ? data.verdi : null;
  const confidence = Number(data.confidence);
  return {
    verdi,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0
  };
}

export function validateTiltaksavklaring(raa: unknown): Tiltaksavklaring | null {
  if (!raa || typeof raa !== "object") return null;
  const data = raa as Record<string, unknown>;
  const fasadeendring = validateFeltavklaring(data.fasadeendring);
  const endringBaerekonstruksjon = validateFeltavklaring(data.endringBaerekonstruksjon);
  if (!fasadeendring || !endringBaerekonstruksjon) return null;
  return {
    fasadeendring,
    endringBaerekonstruksjon,
    tiltak: validateVindustiltak(data.tiltak) ?? undefined,
    begrunnelse: typeof data.begrunnelse === "string" ? data.begrunnelse : "",
    oppfolgingssporsmaal: typeof data.oppfolgingssporsmaal === "string" ? data.oppfolgingssporsmaal : null
  };
}

function harBredUendretBeskrivelse(tekst: string): boolean {
  return treff(tekst, [
    "helt likt",
    "helt lik",
    "akkurat likt",
    "akkurat lik",
    "samme som i dag",
    "ingen endringer",
    "ingen andre endringer",
    "alt er likt"
  ]);
}

function harUendretKjennetegn(tekst: string, kjennetegn: FasadeKjennetegn): boolean {
  if (treff(tekst, kjennetegn.uendret)) return true;
  const ordliste = tekst.split(" ").filter(Boolean);

  for (let indeks = 0; indeks < ordliste.length; indeks += 1) {
    const erNegertEndring =
      ordliste[indeks] === "ikke" && ["endre", "endrer", "endres", "endret"].includes(ordliste[indeks + 1] || "");
    const erIngenEndring =
      ordliste[indeks] === "ingen" && ["endring", "endringer", "endringeri"].includes(ordliste[indeks + 1] || "");
    if (!erNegertEndring && !erIngenEndring) continue;

    const scope = ordliste.slice(indeks + 1, indeks + 9);
    const scopeSet = new Set(scope);
    if (kjennetegn.planord.some((planord) => normalizeText(planord).split(" ").some((ord) => scopeSet.has(ord)))) {
      return true;
    }
  }

  const markorIndex = ordliste.findIndex((ord) => ["samme", "lik", "likt", "uendret"].includes(ord));
  if (markorIndex === -1) return false;

  const somIDagIndex = ordliste.findIndex((ord, indeks) => indeks > markorIndex && ord === "som" && ordliste[indeks + 1] === "i" && ordliste[indeks + 2] === "dag");
  const scope = somIDagIndex > markorIndex
    ? ordliste.slice(markorIndex + 1, somIDagIndex)
    : ordliste.slice(markorIndex + 1, markorIndex + 10);
  if (!scope.length) return false;

  const scopeSet = new Set(scope);
  return kjennetegn.planord.some((planord) => normalizeText(planord).split(" ").some((ord) => scopeSet.has(ord)));
}

function harAvklartKjennetegn(tekst: string, kjennetegn: FasadeKjennetegn): boolean {
  return treff(tekst, kjennetegn.endret) || harUendretKjennetegn(tekst, kjennetegn);
}

function harSammeVindusaapning(tekst: string): boolean {
  return harUendretKjennetegn(tekst, fasadeKjennetegn[0]) && harUendretKjennetegn(tekst, fasadeKjennetegn[2]);
}

function naturligListe(verdier: string[]): string {
  if (verdier.length <= 1) return verdier[0] || "";
  if (verdier.length === 2) return verdier.join(" og ");
  return `${verdier.slice(0, -1).join(", ")} og ${verdier[verdier.length - 1]}`;
}

function storForbokstav(tekst: string): string {
  return tekst ? tekst[0].toUpperCase() + tekst.slice(1) : tekst;
}

function sporsmalsliste(deler: string[]): string {
  if (deler.length <= 1) return `${deler[0] || "kan du beskrive tiltaket litt mer"}?`;
  return `${deler.slice(0, -1).map((del) => `${del}?`).join(" ")} ${storForbokstav(deler[deler.length - 1])}?`;
}

function erVeiledningssporsmaalOmBaering(tekst: string): boolean {
  const sporreord = ["hva", "hvilke", "hvordan", "betyr", "mener", "forklar", "si mer"];
  const tema = ["bærekonstruksjon", "baerekonstruksjon", "bærende", "baerende", "bærevegg", "baerevegg", "konstruksjon"];
  return sporreord.some((ord) => treff(tekst, [ord])) && tema.some((ord) => treff(tekst, [ord]));
}

function relevanteKjennetegnFraPlan(body: TiltaksomfangKropp): FasadeKjennetegn[] {
  const planTekst = normalizeText(JSON.stringify(body?.kontekst?.reguleringsplan || {}));
  const fraPlan = fasadeKjennetegn.filter((kjennetegn) => treff(planTekst, kjennetegn.planord));
  return fraPlan.length ? fraPlan : fasadeKjennetegn;
}

function vurderFasadeendring(body: TiltaksomfangKropp): { felt: Feltavklaring; mangler: string[]; avklart: string[]; kilde: string } {
  const tekst = tiltaksomfangTekst(body);
  const relevante = relevanteKjennetegnFraPlan(body);
  const endret = relevante.find((kjennetegn) => treff(tekst, kjennetegn.endret) && !harUendretKjennetegn(tekst, kjennetegn));
  if (endret) {
    return { felt: { verdi: true, confidence: 0.9 }, mangler: [], avklart: [endret.label], kilde: `Bruker oppga endring i ${endret.label}.` };
  }

  if (harBredUendretBeskrivelse(tekst)) {
    return { felt: { verdi: false, confidence: 0.9 }, mangler: [], avklart: relevante.map((kjennetegn) => kjennetegn.label), kilde: "Bruker oppga at vinduet blir helt likt som i dag." };
  }

  const avklart = relevante
    .filter((kjennetegn) => harAvklartKjennetegn(tekst, kjennetegn))
    .map((kjennetegn) => kjennetegn.label);
  const mangler = relevante
    .filter((kjennetegn) => !harUendretKjennetegn(tekst, kjennetegn))
    .map((kjennetegn) => kjennetegn.label);

  if (mangler.length === 0) {
    return { felt: { verdi: false, confidence: 0.85 }, mangler, avklart, kilde: "Bruker har dekket planens relevante fasadekjennetegn." };
  }

  return { felt: { verdi: null, confidence: 0.35 }, mangler, avklart, kilde: "Bruker har bare dekket deler av fasadeavklaringen." };
}

function vurderBaerekonstruksjon(body: TiltaksomfangKropp): Feltavklaring {
  const tekst = tiltaksomfangTekst(body);
  if (erVeiledningssporsmaalOmBaering(normalizeText(body?.tekst || ""))) {
    return { verdi: null, confidence: 0.2 };
  }

  if (harBredUendretBeskrivelse(tekst)) {
    return { verdi: false, confidence: 0.85 };
  }

  const avkreftet = treff(tekst, [
    "ikke bærende",
    "ikke baerende",
    "ikke endring i bærende",
    "ikke endring i baerende",
    "ikke bærekonstruksjon",
    "ikke baerekonstruksjon",
    "ingen endring i bærekonstruksjon",
    "ingen endring i baerekonstruksjon",
    "ikke endre bærevegg",
    "ikke endre baerevegg",
    "ikke endre konstruksjon",
    "ikke endre konstruksjonen",
    "ingen bærende vegg",
    "ingen baerende vegg",
    "uten å endre veggen",
    "samme åpning",
    "samme apning",
    "samme hull"
  ]);
  if (avkreftet) return { verdi: false, confidence: 0.9 };

  const bekreftet = treff(tekst, [
    "endre bærende vegg",
    "endre baerende vegg",
    "endre bærevegg",
    "endre baerevegg",
    "endre bærekonstruksjon",
    "endre baerekonstruksjon",
    "berører bærende",
    "berorer baerende",
    "berører bærekonstruksjon",
    "berorer baerekonstruksjon",
    "må forsterkes",
    "ma forsterkes",
    "større hull",
    "storre hull",
    "nytt hull"
  ]);
  if (bekreftet) return { verdi: true, confidence: 0.9 };

  if (harSammeVindusaapning(tekst)) {
    return { verdi: false, confidence: 0.85 };
  }

  return { verdi: null, confidence: 0.3 };
}

function settHvisKjent<T extends Record<string, unknown>, K extends keyof T>(objekt: T, noekkel: K, verdi: T[K] | null): void {
  if (verdi !== null) {
    objekt[noekkel] = verdi;
  }
}

function boolFraTekst(tekst: string, ja: string[], nei: string[]): boolean | null {
  const harNei = treff(tekst, nei);
  const harJa = treff(tekst, ja);
  if (harNei) return false;
  if (harJa && !harNei) return true;
  return null;
}

function boolFraKjennetegn(tekst: string, kjennetegn: FasadeKjennetegn): boolean | null {
  const harJa = treff(tekst, kjennetegn.endret);
  if (harJa && !treff(tekst, kjennetegn.uendret)) return true;
  if (harUendretKjennetegn(tekst, kjennetegn)) return false;
  return null;
}

function byggVindustiltak(svar: Tiltaksavklaring, body: TiltaksomfangKropp, fasade: { felt: Feltavklaring }, baering: Feltavklaring): Vindustiltak {
  const tekst = tiltaksomfangTekst(body);
  const tiltak: Vindustiltak = structuredClone(svar.tiltak ?? TOMT_VINDUSTILTAK);
  settHvisKjent(tiltak.visuelt, "storrelseEndres", boolFraKjennetegn(tekst, fasadeKjennetegn[0]));
  settHvisKjent(tiltak.visuelt, "plasseringEndres", boolFraKjennetegn(tekst, fasadeKjennetegn[2]));
  settHvisKjent(tiltak.visuelt, "hovedinndelingEndres", boolFraKjennetegn(tekst, fasadeKjennetegn[3]));
  settHvisKjent(tiltak.visuelt, "fargeEndres", boolFraKjennetegn(tekst, fasadeKjennetegn[4]));
  settHvisKjent(tiltak.visuelt, "materialeEndres", boolFraKjennetegn(tekst, fasadeKjennetegn[5]));
  settHvisKjent(tiltak.plassering, "motGate", boolFraTekst(
    tekst,
    ["mot gate", "mot vei", "mot vegen", "mot veien"],
    ["ikke mot gate", "ikke være mot gate", "ikke vere mot gate", "vender ikke mot gate", "ikke mot vei", "mot hage", "mot bakgård", "mot bakgard"]
  ));
  settHvisKjent(tiltak.konstruksjon, "baerendeKonstruksjonBerort", baering.verdi);

  if (fasade.felt.verdi === true && tiltak.visuelt.fargeEndres === null && treff(tekst, fasadeKjennetegn[4].endret)) {
    tiltak.visuelt.fargeEndres = true;
  }

  return tiltak;
}

function lesSti(objekt: unknown, sti: string | undefined): unknown {
  if (!sti) return undefined;
  const deler = sti.replace(/^tiltak\./, "").split(".");
  let verdi: unknown = objekt;
  for (const del of deler) {
    if (!verdi || typeof verdi !== "object") return undefined;
    verdi = (verdi as Record<string, unknown>)[del];
  }
  return verdi;
}

function erTomKravverdi(verdi: unknown): boolean {
  return verdi === null || verdi === undefined || (typeof verdi === "string" && !verdi.trim());
}

function strukturerteKravFraPlan(body: TiltaksomfangKropp): ({ bestemmelseId: string; kravId: string; gjelder?: string; naar?: unknown; paakrevdeFelter: string[]; veiledning: string })[] {
  const plan = body?.kontekst?.reguleringsplan;
  if (!plan || typeof plan !== "object") return [];
  const bestemmelser = Array.isArray((plan as Record<string, unknown>).vindusbestemmelser)
    ? (plan as Record<string, unknown>).vindusbestemmelser as Record<string, unknown>[]
    : [];
  return bestemmelser.flatMap((bestemmelse) => {
    const bestemmelseId = typeof bestemmelse.bestemmelseId === "string" ? bestemmelse.bestemmelseId : "ukjent-bestemmelse";
    const krav = Array.isArray(bestemmelse.krav) ? bestemmelse.krav as Record<string, unknown>[] : [];
    return krav.map((kravrad, indeks) => ({
      bestemmelseId,
      kravId: typeof kravrad.kravId === "string" ? kravrad.kravId : `${bestemmelseId}-${indeks + 1}`,
      gjelder: typeof kravrad.gjelder === "string" ? kravrad.gjelder : undefined,
      naar: kravrad.naar,
      paakrevdeFelter: Array.isArray(kravrad.paakrevdeFelter) ? kravrad.paakrevdeFelter.filter((felt): felt is string => typeof felt === "string") : [],
      veiledning: typeof kravrad.veiledning === "string" ? kravrad.veiledning : "Kan du beskrive tiltaket litt mer?"
    }));
  });
}

function vurderStrukturerteKrav(tiltak: Vindustiltak, body: TiltaksomfangKropp): Kravvurdering[] {
  return strukturerteKravFraPlan(body).map((krav) => {
    const aktivt = krav.gjelder ? lesSti(tiltak, krav.gjelder) === krav.naar : true;
    const mangler = aktivt
      ? krav.paakrevdeFelter.filter((felt) => erTomKravverdi(lesSti(tiltak, felt)))
      : [];
    return {
      bestemmelseId: krav.bestemmelseId,
      kravId: krav.kravId,
      status: mangler.length ? "mangler_fakta" : "oppfylt",
      mangler,
      veiledning: krav.veiledning
    };
  });
}

function planstyrteOppfolgingsdeler(body: TiltaksomfangKropp): string[] {
  const tekst = tiltaksomfangTekst(body);
  const planTekst = normalizeText(JSON.stringify(body?.kontekst?.reguleringsplan || {}));
  const deler: string[] = [];

  if (treff(tekst, ["annen farge", "ny farge", "bytte farge", "endre farge"]) && treff(planTekst, ["dempet fargebruk"])) {
    deler.push("hvilken farge vinduet skal få, siden planen sier at vinduer skal ha dempet fargebruk og tilpasses bebyggelsens karakter");
  }

  if (treff(planTekst, ["vinduer mot gate"]) && !treff(tekst, ["mot gate", "ikke mot gate", "mot vei", "mot vegen", "mot veien", "mot hage", "mot bakgård", "mot bakgard"])) {
    deler.push("om vinduet vender mot gate, fordi planen sier at vinduer mot gate skal følge eksisterende vinduers hovedinndeling og visuelle uttrykk");
  }

  return deler;
}

function byggTiltaksomfangOppfolging(fasade: { mangler: string[]; avklart: string[] }, baering: Feltavklaring, body: TiltaksomfangKropp): string {
  const planTekst = normalizeText(JSON.stringify(body?.kontekst?.reguleringsplan || {}));
  const vernet = ["h570", "bevaring", "kulturmiljø", "kulturmiljo"].some((ord) => planTekst.includes(ord));
  const deler = [];
  deler.push(...planstyrteOppfolgingsdeler(body));
  if (fasade.mangler.length) {
    deler.push(`får vinduet samme ${naturligListe(fasade.mangler)} som i dag`);
  }
  if (baering.verdi === null) {
    deler.push("krever arbeidet endring i bærende vegg eller konstruksjon");
  }
  const intro = vernet
    ? "Planen har bevaringshensyn, så jeg må være litt presis:"
    : "Jeg må avklare litt mer:";
  const avklart = fasade.avklart.length
    ? `Jeg har fått med meg det du sa om ${naturligListe(fasade.avklart)}. `
    : "";
  return `${intro} ${avklart}Kan du svare på det som fortsatt mangler: ${sporsmalsliste(deler)}`;
}

export function medDeterministiskTiltaksomfangSjekk(svar: Tiltaksavklaring, body: TiltaksomfangKropp): Tiltaksavklaring {
  const fasade = vurderFasadeendring(body);
  const baering = vurderBaerekonstruksjon(body);
  const tiltak = byggVindustiltak(svar, body, fasade, baering);
  const kravvurdering = vurderStrukturerteKrav(tiltak, body);
  const kravmangler = kravvurdering.filter((krav) => krav.status === "mangler_fakta");
  const neste: Tiltaksavklaring = {
    ...svar,
    fasadeendring: fasade.felt,
    endringBaerekonstruksjon: baering,
    tiltak,
    kravvurdering,
    mangler: [...new Set(kravmangler.flatMap((krav) => krav.mangler))],
    begrunnelse: [svar.begrunnelse, fasade.kilde].filter(Boolean).join(" ")
  };

  if (kravmangler.length) {
    neste.oppfolgingssporsmaal = `Planbestemmelsene trenger mer informasjon: ${kravmangler.map((krav) => krav.veiledning).join(" ")}`;
  } else if (neste.fasadeendring.verdi === null || neste.endringBaerekonstruksjon.verdi === null) {
    neste.oppfolgingssporsmaal = byggTiltaksomfangOppfolging(fasade, baering, body);
  } else {
    neste.oppfolgingssporsmaal = null;
  }
  return neste;
}

export function loggTiltaksomfangUttrekk(svar: Tiltaksavklaring, body: TiltaksomfangKropp): void {
  const plan = body?.kontekst?.reguleringsplan;
  const planId = plan && typeof plan === "object" && typeof (plan as Record<string, unknown>).planId === "string"
    ? (plan as Record<string, unknown>).planId
    : null;
  console.log("tolk-tiltaksomfang: konstruert tiltak-json");
  console.log(JSON.stringify({
    sporingsId: body?.sporingsId ?? null,
    planId,
    tiltak: svar.tiltak ?? null,
    fasadeendring: svar.fasadeendring,
    endringBaerekonstruksjon: svar.endringBaerekonstruksjon
  }, null, 2));
  console.log("tolk-tiltaksomfang: kravvalidering");
  console.log(JSON.stringify({
    sporingsId: body?.sporingsId ?? null,
    planId,
    kravvurdering: svar.kravvurdering ?? [],
    mangler: svar.mangler ?? [],
    oppfolgingssporsmaal: svar.oppfolgingssporsmaal ?? null
  }, null, 2));
}

export function buildTiltaksomfangPrompt(body: TiltaksomfangKropp): string {
  const historikk = Array.isArray(body?.history) ? body.history : [];
  const historikkTekst = historikk
    .map((tur) => `${tur?.role === "bruker" ? "Bruker" : "Assistent"}: ${tur?.message ?? ""}`)
    .join("\n");
  return [
    "Du hjelper en innbygger med å avklare et vindusbytte i en byggesøknad, gjennom en kort samtale.",
    "Svar kun med gyldig JSON og ingen annen tekst. Skjema:",
    '{"tiltak":{"type":"vindusutskifting","plassering":{"motGate":true|false|null},"visuelt":{"storrelseEndres":true|false|null,"plasseringEndres":true|false|null,"hovedinndelingEndres":true|false|null,"fargeEndres":true|false|null,"nyFarge":"tekst eller null","materialeEndres":true|false|null},"konstruksjon":{"baerendeKonstruksjonBerort":true|false|null}},"fasadeendring":{"verdi":true|false|null,"confidence":0.0},"endringBaerekonstruksjon":{"verdi":true|false|null,"confidence":0.0},"begrunnelse":"kort tekst","oppfolgingssporsmaal":"spørsmål til bruker, eller null"}',
    "Fyll tiltak-objektet med fakta fra brukerens tekst og historikken. Bruk null for felt brukeren ikke har oppgitt. Ikke gjett. Planbestemmelsene brukes som krav etterpå, men du skal ikke avgjøre saken.",
    "fasadeendring er sann hvis det nye vinduet får en annen størrelse, form, plassering, stil, farge eller materialbruk enn det som byttes ut. En fargeendring alene er nok til å telle som fasadeendring - den trenger ikke komme sammen med en endring i størrelse, form eller plassering.",
    "fasadeendring har seks kjennetegn: størrelse, form, plassering, stil, farge og materialbruk. Bruker kan bekrefte at ett av dem er uendret uten å ha sagt noe om de andre - sett fasadeendring.verdi=false med høy confidence først når bruker har uttalt seg om alle seks, eller sagt noe som tydelig dekker alle (for eksempel «helt likt i alle henseender» eller «ingen andre endringer»). Er bare ett eller noen kjennetegn nevnt, hold confidence lav og spør om resten - ett av dem kan fortsatt vise seg å endre seg.",
    "endringBaerekonstruksjon er sann hvis installasjonen krever endring i bærende vegg eller konstruksjon, for eksempel et større vindushull eller et nytt hull. Hvis bruker sier at vinduet har samme størrelse og samme plassering, skal det tolkes som samme åpning og ikke som endring i bærende konstruksjon, med mindre bruker samtidig sier at bærende vegg, hull eller forsterking berøres.",
    "Les hele samtalehistorikken under før du svarer. Har bruker allerede svart tydelig på et spørsmål - selv med andre ord enn sist - skal du bruke det svaret, ikke stille det samme spørsmålet på nytt. Gjentar du et spørsmål bruker nettopp svarte på, er det en feil.",
    "Sett verdi til null og confidence lavt (under 0.5) bare når svaret fortsatt mangler etter å ha lest hele historikken, og fyll da ut oppfolgingssporsmaal med ett konkret spørsmål om nettopp det som mangler - aldri et spørsmål du allerede har stilt.",
    "Sett confidence over 0.7 når bruker har vært eksplisitt på akkurat det feltet, i denne meldingen eller tidligere i samtalen.",
    "Sett oppfolgingssporsmaal til null når begge feltene har fått en verdi.",
    "",
    `Grunnlag fra reguleringsplanen for eiendommen: ${JSON.stringify(body?.kontekst || {})}`,
    historikkTekst ? `Tidligere i samtalen:\n${historikkTekst}` : "",
    `Siste melding fra bruker: ${JSON.stringify(body?.tekst || "")}`
  ].filter(Boolean).join("\n");
}