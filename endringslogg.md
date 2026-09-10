# Endringslogg

## Byggesøknad: avklaring av vindusbytte

Det er lagt inn et første samtalesteg i byggesøknadsprosessen for å avklare om et planlagt vindusbytte er en fasadeendring, og om tiltaket berører bærekonstruksjonen. Steget heter `avklar-tiltak` og ligger etter at saksgrunnlaget for eiendommen er hentet.

Brukeren kan beskrive tiltaket med egne ord. Chatten sender teksten til `POST /ai/tolk-tiltaksomfang`, sammen med samtalehistorikken og reguleringsplanen som gjelder for eiendommen i økten.

## Strukturert tiltak

AI-endepunktet bygger nå opp et strukturert JSON-objekt for tiltaket. Modellen kan foreslå innholdet, men serveren etterbehandler og validerer objektet deterministisk.

Eksempel på formen:

```json
{
  "type": "vindusutskifting",
  "plassering": {
    "motGate": null
  },
  "visuelt": {
    "storrelseEndres": false,
    "plasseringEndres": false,
    "hovedinndelingEndres": null,
    "fargeEndres": true,
    "nyFarge": null,
    "materialeEndres": null
  },
  "konstruksjon": {
    "baerendeKonstruksjonBerort": null
  }
}
```

De gamle feltene `fasadeendring` og `endringBaerekonstruksjon` returneres fortsatt for å passe inn i den eksisterende flyten. De avledes fra det strukturerte tiltaket og fra brukerens tekst, men modellen får ikke alene bestemme om confidence er høy nok.

## Reguleringsplan og krav

Huset i økten kobles til matrikkelen, og matrikkel-id-en brukes til å finne riktig plan i `data/reguleringsplan.json`. Det betyr at valideringen tar utgangspunkt i planbestemmelsene som faktisk gjelder for eiendommen.

Vindusrelevante planbestemmelser har fått et nytt felt, `krav`. Kravene peker på felter i tiltak-JSON-en og sier hvilke opplysninger som må være kjent før avklaringen kan gå videre.

Eksempel:

```json
{
  "kravId": "avklar-farge-ved-fargeendring",
  "gjelder": "tiltak.visuelt.fargeEndres",
  "naar": true,
  "paakrevdeFelter": ["tiltak.visuelt.nyFarge"],
  "veiledning": "Hvilken farge skal vinduet få? Planen sier at vinduer skal ha dempet fargebruk og tilpasses bebyggelsens karakter."
}
```

Når `gjelder` matcher verdien i `naar`, sjekker validatoren at alle feltene i `paakrevdeFelter` er utfylt. Mangler noe, returnerer endepunktet `kravvurdering`, `mangler` og et oppfølgingsspørsmål basert på `veiledning`.

## Eksempel på validering

Hvis brukeren sier at vinduet skal få en annen farge, og planen sier at vinduer skal ha dempet fargebruk, blir `tiltak.visuelt.fargeEndres` satt til `true`. Da aktiveres kravet om `tiltak.visuelt.nyFarge`. Hvis brukeren ikke har sagt hvilken farge vinduet skal få, stopper chatten og spør om fargen før den går videre.

Hvis planen har en bestemmelse om vinduer mot gate, aktiveres et krav om å avklare `tiltak.plassering.motGate`. Hvis brukeren svarer at vinduet vender mot gate, kan neste krav spørre om hovedinndeling og visuelt uttrykk blir som eksisterende vinduer.

## Veiledning i chatten

Chatten skiller nå bedre mellom svar og veiledningsspørsmål. Hvis brukeren spør hva en endring i bærekonstruksjon betyr, forklarer chatten begrepet før den fortsetter avklaringen. Et slikt spørsmål skal ikke gi høy confidence for `endringBaerekonstruksjon`, siden brukeren ikke har oppgitt fakta om eget tiltak.

## Videre utfall i prosessen

Etter `avklar-tiltak` ligger nå SJEKK-steget `sjekk-tiltaksomfang`. Det kaller `/api/byggesoknad/sjekk/tiltaksomfang` med de to avklarte feltene fra samtalen.

Utfallet bestemmes i backend:

- Hvis `endringBaerekonstruksjon` er `true`, stopper prosessen. Brukeren får beskjed om å snakke med entreprenør eller ansvarlig fagperson før videre arbeid.
- Hvis `fasadeendring` er `true` og bærekonstruksjonen ikke berøres, går prosessen videre til oppsummering og innsending av byggesøknadsskjema.
- Hvis begge er `false`, stopper prosessen. Brukeren får en oppsummering av at tiltaket ikke endrer fasaden eller bærekonstruksjonen, og at det derfor ikke skal sendes informasjon til kommunen eller entreprenør for dette tiltaket.

AI kan formulere oppsummeringen for utfallet `INGEN_SOKNAD`, men selve utfallet er allerede bestemt av backend. Hvis AI-gateway ikke svarer, brukes en fast fallbacktekst med samme konklusjon.

## Logging

`ai-gateway` logger nå tydelig hva som er trukket ut og validert for `POST /ai/tolk-tiltaksomfang`:

- `tolk-tiltaksomfang: konstruert tiltak-json` viser `sporingsId`, `planId`, `tiltak`, `fasadeendring` og `endringBaerekonstruksjon`.
- `tolk-tiltaksomfang: kravvalidering` viser `kravvurdering`, `mangler` og valgt `oppfolgingssporsmaal`.

Loggene kan følges med:

```powershell
docker compose logs -f ai-gateway
```

## Validering

`pnpm lint` passerer etter endringene. `pnpm test:openapi` har fortsatt eksisterende avvik i `sandbox-backend` knyttet til enum-dokumentasjon, men ingen nye avvik for `ai-gateway`-endringene.