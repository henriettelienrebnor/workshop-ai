import type { Reguleringsplan, State } from "./types.ts";

const vindusrelevanteTema = new Set([
  "fasade",
  "vinduer",
  "farge_og_materialbruk",
  "bevaring",
  "søknadspliktige_tiltak"
]);

const vindusrelevanteKoder = new Set([
  "fasadeendring",
  "vindusendring",
  "nytt_vindu",
  "storrelsesendring"
]);

// PLANREGISTERET
//
// data/reguleringsplan.json er et forenklet kommunalt planregister. Det holdes
// utenfor matrikkel-mock med vilje: en arealplan er kommunens eget vedtak, ikke
// en matrikkelopplysning, og i en ekte kommune er dette to registre med hver sin
// eier. Koblingen mellom dem er matrikkel-id-en, og ingenting annet.

export function finnPlanForEiendom(
  tilstand: State,
  matrikkelId: string | null | undefined
): Reguleringsplan | null {
  if (!matrikkelId) return null;
  return tilstand.reguleringsplan.planer.find((plan) =>
    plan.berorteEiendommer.some((eiendom) => eiendom.matrikkelId === matrikkelId)
  ) ?? null;
}

/**
 * Planen som setninger en saksbehandler eller innbygger kan lese.
 *
 * Formål, hensynssoner og bestemmelser er lister av objekter i registeret, og et
 * steg som skal vise dem trenger tekst. Sammenstillingen gjøres her, ikke i
 * klienten: stegvis, chat og agenten viser den samme saken.
 */
export function planSammendrag(plan: Reguleringsplan) {
  const relevanteBestemmelser = plan.planbestemmelser.filter((bestemmelse) =>
    vindusrelevanteTema.has(bestemmelse.tema) ||
    bestemmelse.relevantFor?.some((kode) => vindusrelevanteKoder.has(kode))
  );

  return {
    planId: plan.planId,
    planNavn: plan.planNavn,
    plantype: plan.plantype,
    planstatus: plan.planstatus,
    kommune: plan.kommune,
    ikrafttredelsesdato: plan.ikrafttredelsesdato,
    lovgrunnlag: plan.lovgrunnlag,
    formaal: plan.formaal.map((f) =>
      f.underformaal ? `${f.navn} (${f.underformaal})` : f.navn
    ),
    hensynssoner: plan.hensynssoner.map((sone) => `${sone.kode} ${sone.navn}`),
    bestemmelsesomraader: plan.bestemmelsesomraader.map((omraade) => `${omraade.kode} ${omraade.navn}`),
    bestemmelser: plan.planbestemmelser.map((b) => `${b.tema}: ${b.tekst}`),
    vindusbestemmelser: relevanteBestemmelser.map((b) => ({
      bestemmelseId: b.bestemmelseId,
      tema: b.tema,
      tekst: b.tekst,
      relevantFor: b.relevantFor ?? [],
      krav: b.krav ?? []
    }))
  };
}
