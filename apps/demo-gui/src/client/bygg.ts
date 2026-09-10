export {};

renderTopNav("/bygg");

const backendBase = "http://localhost:8080";
const aiBase = "http://localhost:8082";
const processId = "byggesoknad";

const qrPanel = krevEl("scanPanel");
const walletPanel = krevEl("walletPanel");
const chatPanel = krevEl("chatPanel");
const scanStatus = krevEl("scanStatus");
const progressScan = krevEl("progressScan");
const progressChat = krevEl("progressChat");
const qrCode = krevEl<HTMLImageElement>("qrCode");
const scanButton = krevEl<HTMLButtonElement>("scanWallet");
const chat = krevEl("chat");
const chatForm = krevEl<HTMLFormElement>("chatForm");
const chatInput = krevEl<HTMLTextAreaElement>("chatInput");
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
  progressScan.classList.remove("active");
  progressChat.classList.add("active");
}

async function receiveWalletData(): Promise<void> {
  scanButton.disabled = true;
  try {
    await nesteSteg();
    setStatus("Venter på godkjenning i Digital lommebok ...");
    await kjorHandling();
    await nesteSteg();
    setStatus("Henter de delte opplysningene ...");
    await kjorHandling();
    await nesteSteg();
    setStatus("Slår opp eiendommen og saksgrunnlaget ...");
    await kjorHandling();
    await nesteSteg();
    showWalletData();
  } catch (error) {
    scanButton.disabled = false;
    setStatus(`Kunne ikke hente opplysningene: ${feilmelding(error)}`);
  }
}

async function sendMessage(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !oekt) return;
  addMessage("user", text);
  chatInput.value = "";
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
    if (data.tekst) addMessage("assistant", data.tekst);
    if (data.advarsel) addMessage("error", data.advarsel);
  } catch (error) {
    addMessage("error", `Fikk ikke svar på spørsmålet: ${feilmelding(error)}`);
  }
}

async function init(): Promise<void> {
  if (!(await requireLogin())) return;
  const personer = await req<Person[]>("/api/personer");
  person = showLoggedInPerson(personSelect, personer);
  const prosesser = await req<Prosess[]>("/api/prosesser");
  prosess = prosesser.find((candidate) => candidate.id === processId) || null;
  if (!prosess) throw new Error(`Fant ikke prosessen ${processId}.`);
  await startVerification();
}

scanButton.addEventListener("click", () => showWalletData());
krevEl("openChat").addEventListener("click", () => {
  qrPanel.hidden = true;
  qrPanel.style.display = "none";
  walletPanel.hidden = true;
  chatPanel.hidden = false;
  progressScan.classList.remove("active");
  progressChat.classList.add("active");
  addMessage(
    "assistant",
    `Hei! Jeg kan hjelpe deg å finne ut om du trenger byggesøknad for ${textValue(resultFor("hent-resultat").eiendomsadresse)}. Hva planlegger du å bygge eller endre?`,
  );
  chatInput.focus();
});
chatForm.addEventListener("submit", (event) => void sendMessage(event));

init().catch((error) => {
  setStatus(`Kunne ikke starte byggesaken: ${feilmelding(error)}`);
});
