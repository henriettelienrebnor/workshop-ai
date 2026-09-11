export {};

renderTopNav("/bygg");

const backendBase = "http://localhost:8080";
const aiBase = "http://localhost:8082";
const processId = "byggesoknad";

const qrPanel = krevEl("scanPanel");
const walletPanel = krevEl("walletPanel");
const chatPanel = krevEl("chatPanel");
const applicationPanel = krevEl("applicationPanel");
const applicationOverview = krevEl("applicationOverview");
const sendNeighborNotice = krevEl<HTMLButtonElement>("sendNeighborNotice");
const neighborNoticeStatus = krevEl("neighborNoticeStatus");
const scanStatus = krevEl("scanStatus");

const progressScan = krevEl("progressScan");
const progressChat = krevEl("progressChat");
const progressApplication = krevEl("byggesoknad");
const qrCode = krevEl<HTMLImageElement>("qrCode");
const scanButton = krevEl<HTMLButtonElement>("scanWallet");
const chat = krevEl("chat");
const chatForm = krevEl<HTMLFormElement>("chatForm");
const chatInput = krevEl<HTMLTextAreaElement>("chatInput");
const chatSubmitBtn = chatForm.querySelector(
  'button[type="submit"]',
) as HTMLButtonElement;
const personSelect = krevEl<HTMLSelectElement>("personvelger");

type Resultat = Record<string, unknown>;
type Handlingssvar = { oekt: Prosessoekt; resultat?: Resultat };
type SporsmaalSvar = { tekst?: string; feil?: string; advarsel?: string };

let oekt: Prosessoekt | null = null;
let prosess: Prosess | null = null;
let person: Person | null = null;

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${backendBase}${path}`, {
    ...options,
    headers: withToken({
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> | undefined),
    }),
  });
  const data = (await response.json()) as { feil?: string };
  if (!response.ok) throw new Error(data.feil || `Feil ${response.status}`);
  return data as T;
}

function resultFor(stepId: string): Resultat {
  const result = oekt?.resultater?.[stepId];
  return result && typeof result === "object" && !Array.isArray(result)
    ? (result as Resultat)
    : {};
}

function textValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "Ikke oppgitt";
}

function setStatus(text: string): void {
  scanStatus.textContent = text;
}

function lagSpinner(): SVGSVGElement {
  const spinner = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  spinner.classList.add("ds-spinner");
  spinner.dataset.size = "md";
  spinner.setAttribute("viewBox", "0 0 50 50");
  spinner.setAttribute("role", "img");
  spinner.setAttribute("aria-label", "Laster");
  for (const klasse of ["ds-spinner__background", "ds-spinner__circle"]) {
    const circle = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    circle.classList.add(klasse);
    circle.setAttribute("cx", "25");
    circle.setAttribute("cy", "25");
    circle.setAttribute("r", "20");
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke-width", "5");
    spinner.appendChild(circle);
  }
  return spinner;
}

function setStatusLoading(text: string, loading: boolean): void {
  scanStatus.replaceChildren();
  if (loading) scanStatus.appendChild(lagSpinner());
  scanStatus.appendChild(document.createTextNode(text));
}

function addLoadingMessage(): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "msg assistant";
  row.id = "chatLoading";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.appendChild(lagSpinner());
  bubble.appendChild(document.createTextNode("Laster svar ..."));
  row.appendChild(bubble);
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
  return row;
}

function addMessage(role: "assistant" | "user" | "error", text: string): void {
  const row = document.createElement("div");
  row.className = `msg ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  row.appendChild(bubble);
  chat.appendChild(row);

  chat.scrollTop = chat.scrollHeight;
}

function viserSoknadsplikt(text: string): boolean {
  const normalized = text.toLocaleLowerCase("nb-NO");
  return (
    normalized.includes("må søke") ||
    normalized.includes("må sende inn") ||
    normalized.includes("søknadspliktig") ||
    normalized.includes("søke byggesøknad") ||
    normalized.includes("krever søknad") ||
    normalized.includes("du må sende søknad")
  );
}

function visSoknadslenke(): void {
  if (document.getElementById("fyllUtByggesoknad")) return;

  const wrapper = document.createElement("div");
  wrapper.className = "actions";

  const button = document.createElement("button");
  button.className = "ds-button";
  button.id = "fyllUtByggesoknad";
  button.type = "button";
  button.textContent = "Fyll ut byggesøknaden";
  button.addEventListener("click", openApplicationForm);

  wrapper.appendChild(button);
  chat.appendChild(wrapper);
  chat.scrollTop = chat.scrollHeight;
}

function addOverviewSection(title: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "overview-section";
  const heading = document.createElement("h3");
  heading.className = "ds-heading";
  heading.dataset.size = "sm";
  heading.textContent = title;
  section.appendChild(heading);
  applicationOverview.appendChild(section);
  return section;
}

function addOverviewData(
  section: HTMLElement,
  rows: Array<[string, unknown]>,
): void {
  const list = document.createElement("dl");
  list.className = "overview-data";
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = textValue(value);
    list.append(term, description);
  }
  section.appendChild(list);
}

function renderApplicationOverview(): void {
  applicationOverview.replaceChildren();
  const source = resultFor("hent-saksgrunnlag");
  const eiendom = (source.eiendom || {}) as Resultat;
  const plan = (source.reguleringsplan || {}) as Resultat;

  const propertySection = addOverviewSection("Eiendom og søker");
  addOverviewData(propertySection, [
    [
      "Søker",
      `${textValue(resultFor("hent-resultat").fornavn)} ${textValue(resultFor("hent-resultat").etternavn)}`,
    ],
    ["Adresse", eiendom.adresse || resultFor("hent-resultat").eiendomsadresse],
    ["Kommune", eiendom.kommune],
    ["Matrikkelnummer", eiendom.matrikkelnummer],
  ]);

  const planSection = addOverviewSection("Plan og bestemmelser");
  addOverviewData(planSection, [
    ["Reguleringsplan", plan.planNavn || source.planmerknad],
    [
      "Plan-ID og status",
      plan.planId
        ? `${textValue(plan.planId)} · ${textValue(plan.plantype)} · ${textValue(plan.planstatus)}`
        : "Ikke oppgitt",
    ],
    ["Arealformål", plan.formaal],
    ["Bestemmelser", plan.bestemmelser],
  ]);

  const neighborSection = addOverviewSection("Mottakere av nabovarsel");
  const neighbors = Array.isArray(source.naboer) ? source.naboer : [];
  const addresses = Array.isArray(source.naboadresser)
    ? source.naboadresser
    : [];
  const list = document.createElement("ul");
  list.className = "neighbor-list";
  for (const neighbor of neighbors) {
    const item = document.createElement("li");
    const data = (neighbor || {}) as Resultat;
    item.textContent = `${textValue(data.adresse)} (${textValue(data.matrikkelId)})`;
    list.appendChild(item);
  }
  if (neighbors.length === 0) {
    for (const address of addresses) {
      const item = document.createElement("li");
      item.textContent = textValue(address);
      list.appendChild(item);
    }
  }
  if (list.children.length === 0) {
    const empty = document.createElement("p");
    empty.className = "ds-paragraph";
    empty.textContent = "Nabolisten er ikke hentet ennå.";
    neighborSection.appendChild(empty);
  } else {
    neighborSection.appendChild(list);
  }
  const note = document.createElement("p");
  note.className = "ds-paragraph";
  note.textContent = textValue(source.nabolistegrunnlag);
  neighborSection.appendChild(note);
}

function oppdaterFremdrift(aktivtId: "scan" | "chat" | "soknad"): void {
  progressScan.classList.toggle("active", aktivtId === "scan");
  progressChat.classList.toggle("active", aktivtId === "chat");
  progressApplication.classList.toggle("active", aktivtId === "soknad");

  progressScan.removeAttribute("aria-current");
  progressChat.removeAttribute("aria-current");
  progressApplication.removeAttribute("aria-current");

  if (aktivtId === "scan") progressScan.setAttribute("aria-current", "step");
  if (aktivtId === "chat") progressChat.setAttribute("aria-current", "step");
  if (aktivtId === "soknad")
    progressApplication.setAttribute("aria-current", "step");
}

function openApplicationForm(): void {
  qrPanel.hidden = true;
  qrPanel.style.display = "none";
  walletPanel.hidden = true;
  chatPanel.hidden = true;
  applicationPanel.hidden = false;
  renderApplicationOverview();

  oppdaterFremdrift("soknad");

  applicationPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function nesteSteg(): Promise<void> {
  if (!oekt) throw new Error("Prosessøkten er ikke startet.");
  oekt = await req<Prosessoekt>(`/api/prosessoekter/${oekt.oektsId}/neste`, {
    method: "POST",
    body: "{}",
  });
}

async function kjorHandling(): Promise<Resultat> {
  if (!oekt) throw new Error("Prosessøkten er ikke startet.");
  const response = await req<Handlingssvar>(
    `/api/prosessoekter/${oekt.oektsId}/handling`,
    { method: "POST", body: "{}" },
  );
  oekt = response.oekt;
  return response.resultat || {};
}

function visQr(): void {
  const url = oekt?.aktivtSteg?.bilde?.url;
  if (!erVisbartBilde(url))
    throw new Error("Backend returnerte ingen gyldig QR-kode.");

  qrCode.src = url;
  qrCode.alt = oekt?.aktivtSteg?.bilde?.alt || "QR-kode for Digital lommebok";
  qrCode.hidden = false;
  scanButton.disabled = false;
  setStatus("Skann QR-koden og godkjenn delingen i Digital lommebok.");
}

async function startVerification(): Promise<void> {
  if (!person || !prosess)
    throw new Error("Fant ikke innlogget bruker eller prosess.");

  oekt = await req<Prosessoekt>("/api/prosessoekter", {
    method: "POST",
    body: JSON.stringify({
      personId: person.personId,
      prosessId: prosess.id,
      sporingsId: `bygg-${Date.now()}`,
    }),
  });

  await nesteSteg();
  setStatus("Starter forespørsel mot Digital lommebok ...");
  await kjorHandling();
  await nesteSteg();
  visQr();
}

function showWalletData(): void {
  const wallet = resultFor("hent-resultat");
  const name =
    `${textValue(wallet.fornavn)} ${textValue(wallet.etternavn)}`.trim();

  krevEl("walletAddress").textContent = textValue(wallet.eiendomsadresse);
  krevEl("walletName").textContent = name || "Ikke oppgitt";
  krevEl("walletPersonId").textContent = textValue(wallet.personnummer);

  qrPanel.hidden = true;
  qrPanel.style.display = "none";
  walletPanel.hidden = false;
  chatPanel.hidden = false;

  oppdaterFremdrift("chat");

  addMessage(
    "assistant",
    `Hei! Jeg kan hjelpe deg å finne ut om du trenger byggesøknad for ${textValue(wallet.eiendomsadresse)}. Hva planlegger du å bygge eller endre?`,
  );

  const walletTitle = krevEl("walletTitle");
  walletTitle.setAttribute("tabindex", "-1");
  walletTitle.focus();
}

async function receiveWalletData(): Promise<void> {
  scanButton.disabled = true;
  setStatusLoading("Henter opplysninger ...", true);
  try {
    await nesteSteg();
    setStatusLoading("Venter på godkjenning i Digital lommebok ...", true);
    await kjorHandling();
    await nesteSteg();
    setStatusLoading("Henter de delte opplysningene ...", true);
    await kjorHandling();
    await nesteSteg();
    setStatusLoading("Slår opp eiendommen og saksgrunnlaget ...", true);
    await kjorHandling();
    await nesteSteg();
    showWalletData();
  } catch (error) {
    scanButton.disabled = false;
    setStatusLoading(
      `Kunne ikke hente opplysningene: ${feilmelding(error)}`,
      false,
    );
  }
}

async function sendMessage(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !oekt) return;

  chatInput.disabled = true;
  if (chatSubmitBtn) chatSubmitBtn.disabled = true;

  addMessage("user", text);
  chatInput.value = "";
  const loadingMessage = addLoadingMessage();

  try {
    const response = await fetch(`${aiBase}/ai/sporsmaal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tekst: text,
        sporingsId: oekt.sporingsId,
        sprak: "nb",
        kontekst: {
          tjeneste: prosess?.navn,
          prosess,
          steg: oekt.aktivtSteg,
          resultater: oekt.resultater,
          svar: oekt.svar,
        },
      }),
    });

    const data = (await response.json()) as SporsmaalSvar;
    if (!response.ok) throw new Error(data.feil || `Feil ${response.status}`);
    loadingMessage.remove();

    if (data.tekst) {
      addMessage("assistant", data.tekst);
      if (viserSoknadsplikt(data.tekst)) visSoknadslenke();
    }
    if (data.advarsel) addMessage("error", data.advarsel);
  } catch (error) {
    loadingMessage.remove();
    addMessage("error", `Fikk ikke svar på spørsmålet: ${feilmelding(error)}`);
  } finally {
    chatInput.disabled = false;
    if (chatSubmitBtn) chatSubmitBtn.disabled = false;
    chatInput.focus();
  }
}

async function init(): Promise<void> {
  if (new URLSearchParams(location.search).get("test") === "skjema") {
    openApplicationForm();
    return;
  }
  if (!(await requireLogin())) return;

  const personer = await req<Person[]>("/api/personer");
  person = showLoggedInPerson(personSelect, personer);

  const prosesser = await req<Prosess[]>("/api/prosesser");
  prosess = prosesser.find((candidate) => candidate.id === processId) || null;

  if (!prosess) throw new Error(`Fant ikke prosessen ${processId}.`);
  await startVerification();
}

scanButton.addEventListener("click", () => void receiveWalletData());

chatForm.addEventListener("submit", (event) => void sendMessage(event));

sendNeighborNotice.addEventListener("click", () => {
  applicationOverview.hidden = true;
  sendNeighborNotice.hidden = true;
  neighborNoticeStatus.hidden = false;
});

init().catch((error) => {
  setStatus(`Kunne ikke starte byggesaken: ${feilmelding(error)}`);
});
