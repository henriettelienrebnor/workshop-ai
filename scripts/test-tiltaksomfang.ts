#!/usr/bin/env node

/*
 * Unit tests for the tiltaksomfang extraction around /ai/tolk-tiltaksomfang.
 *
 * These tests call the pure post-processing module directly. They need no
 * running stack and no model, because the regressions they guard against were
 * deterministic: repeated follow-up questions, assistant text used as evidence,
 * negations read as positives, and missing inference from same window opening.
 */

import {
  medDeterministiskTiltaksomfangSjekk,
  TILTAKSOMFANG_FALLBACK
} from "../apps/ai-gateway/src/tiltaksomfang.ts";
import type { Tiltaksavklaring } from "../apps/ai-gateway/src/tiltaksomfang.ts";

let bestatt = 0;
const feil: string[] = [];

function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) {
    bestatt += 1;
    return;
  }
  feil.push(`${navn}${detalj ? ` - ${detalj}` : ""}`);
}

function vurder(
  tekst: string,
  options: {
    history?: { role?: string; message?: string }[];
    kontekst?: Record<string, unknown>;
    modellSvar?: Partial<Tiltaksavklaring>;
  } = {}
): Tiltaksavklaring {
  return medDeterministiskTiltaksomfangSjekk(
    { ...structuredClone(TILTAKSOMFANG_FALLBACK), ...options.modellSvar },
    { tekst, history: options.history, kontekst: options.kontekst }
  );
}

function manglerDel(svar: Tiltaksavklaring): string {
  return svar.oppfolgingssporsmaal?.split("fortsatt mangler:")[1] || "";
}

const planMedVinduskrav = {
  reguleringsplan: {
    planId: "test-plan",
    vindusbestemmelser: [
      {
        bestemmelseId: "B07",
        tema: "vinduer",
        tekst: "Vinduer skal ha dempet fargebruk og tilpasses bebyggelsens karakter.",
        krav: [
          {
            kravId: "avklar-farge-ved-fargeendring",
            gjelder: "tiltak.visuelt.fargeEndres",
            naar: true,
            paakrevdeFelter: ["tiltak.visuelt.nyFarge"],
            veiledning: "Hvilken farge skal vinduet få?"
          }
        ]
      }
    ]
  }
};

/* ── Samtalehistorikk og gjentatte spørsmål ──────────────────────────────── */

{
  const svar = vurder("Det skal ha samme form, stil og uttrykk og farge som i dag.", {
    history: [
      {
        role: "assistent",
        message: "Kan du si om vinduet får samme form, plassering, stil og uttrykk, farge som i dag og om arbeidet krever endring i bærende vegg eller konstruksjon?"
      }
    ]
  });

  check("gruppert stil og uttrykk avklares", svar.tiltak?.visuelt.hovedinndelingEndres === false, JSON.stringify(svar.tiltak?.visuelt));
  check("gruppert farge avklares", svar.tiltak?.visuelt.fargeEndres === false, JSON.stringify(svar.tiltak?.visuelt));
  check("oppfølging spør ikke om stil på nytt", !manglerDel(svar).includes("stil og uttrykk"), svar.oppfolgingssporsmaal || "");
  check("oppfølging spør ikke om farge på nytt", !manglerDel(svar).includes("farge"), svar.oppfolgingssporsmaal || "");
}

/* ── Assistentens spørsmål er ikke faktagrunnlag ─────────────────────────── */

{
  const svar = vurder("Det blir helt likt.", {
    history: [
      {
        role: "assistent",
        message: "Krever arbeidet endring i bærende vegg eller konstruksjon?"
      }
    ]
  });

  check("assistentens bærende-spørsmål gir ikke positiv konstruksjon", svar.endringBaerekonstruksjon.verdi === false, JSON.stringify(svar.endringBaerekonstruksjon));
}

/* ── Samme åpning avklarer konstruksjon ──────────────────────────────────── */

{
  const svar = vurder("Vinduet skal ha samme størrelse og plassering som i dag.");

  check("samme størrelse trekkes ut", svar.tiltak?.visuelt.storrelseEndres === false, JSON.stringify(svar.tiltak?.visuelt));
  check("samme plassering trekkes ut", svar.tiltak?.visuelt.plasseringEndres === false, JSON.stringify(svar.tiltak?.visuelt));
  check("samme åpning avkrefter konstruksjonsendring", svar.endringBaerekonstruksjon.verdi === false, JSON.stringify(svar.endringBaerekonstruksjon));
  check("tiltak-json får konstruksjon=false", svar.tiltak?.konstruksjon.baerendeKonstruksjonBerort === false, JSON.stringify(svar.tiltak?.konstruksjon));
  check("oppfølging spør ikke om konstruksjon når samme åpning er avklart", !svar.oppfolgingssporsmaal?.includes("bærende"), svar.oppfolgingssporsmaal || "");
}

{
  const svar = vurder("Samme størrelse og plassering, men vi må endre bærende vegg.");

  check("eksplisitt konstruksjonsendring vinner", svar.endringBaerekonstruksjon.verdi === true, JSON.stringify(svar.endringBaerekonstruksjon));
}

{
  const svar = vurder("Vinduet får samme form som i dag, men det vil bli litt større. Arbeidet krever ikke endring i bærende vegg eller konstruksjon", {
    history: [
      { role: "bruker", message: "Vinduet skal ikke endre form eller farge." },
      { role: "assistent", message: "Kan du svare på det som fortsatt mangler: får vinduet samme form og plassering som i dag? Krever arbeidet endring i bærende vegg eller konstruksjon?" }
    ],
    modellSvar: {
      oppfolgingssporsmaal: "Kan du svare på det som fortsatt mangler: får vinduet samme plassering som i dag? Krever arbeidet endring i bærende vegg eller konstruksjon?"
    }
  });

  check("større vindu avklarer fasadeendring", svar.fasadeendring.verdi === true, JSON.stringify(svar.fasadeendring));
  check("ikke endring i bærende avkrefter konstruksjon", svar.endringBaerekonstruksjon.verdi === false, JSON.stringify(svar.endringBaerekonstruksjon));
  check("tidligere gruppert fargesvar brukes", svar.tiltak?.visuelt.fargeEndres === false, JSON.stringify(svar.tiltak?.visuelt));
  check("stale oppfølging ryddes når begge felt er avklart", svar.oppfolgingssporsmaal === null, svar.oppfolgingssporsmaal || "");
}

/* ── Fasadeendring og negasjon ───────────────────────────────────────────── */

{
  const svar = vurder("Det skal være litt mindre enn forrige vindu, men samme plass.");

  check("mindre vindu er fasadeendring", svar.fasadeendring.verdi === true, JSON.stringify(svar.fasadeendring));
  check("mindre trekkes ut som størrelse endres", svar.tiltak?.visuelt.storrelseEndres === true, JSON.stringify(svar.tiltak?.visuelt));
  check("samme plass trekkes ut som plassering uendret", svar.tiltak?.visuelt.plasseringEndres === false, JSON.stringify(svar.tiltak?.visuelt));
}

{
  const svar = vurder("Vinduet skal ikke være mot gate.");

  check("ikke mot gate blir false", svar.tiltak?.plassering.motGate === false, JSON.stringify(svar.tiltak?.plassering));
}

/* ── Reguleringsplanens strukturerte krav ────────────────────────────────── */

{
  const svar = vurder("Vinduet får ny farge.", { kontekst: planMedVinduskrav });

  check("fargeendring trekkes ut", svar.tiltak?.visuelt.fargeEndres === true, JSON.stringify(svar.tiltak?.visuelt));
  check("planstyrt krav mangler ny farge", svar.mangler?.includes("tiltak.visuelt.nyFarge"), JSON.stringify(svar.mangler));
  check("oppfølging spør om farge fra kravet", svar.oppfolgingssporsmaal?.includes("Hvilken farge"), svar.oppfolgingssporsmaal || "");
}

/* ── Oppsummering ────────────────────────────────────────────────────────── */

const totalt = bestatt + feil.length;
if (feil.length > 0) {
  console.error(`Tiltaksomfangtest: ${bestatt}/${totalt} bestått.\n`);
  for (const linje of feil) {
    console.error(`  ✗ ${linje}`);
  }
  process.exit(1);
}

console.log(`Tiltaksomfangtest ok. ${bestatt}/${totalt} sjekker bestått.`);