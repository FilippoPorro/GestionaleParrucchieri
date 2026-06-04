import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";
import { db } from "../db_parrucchieri";

const router = express.Router();

dotenv.config({ path: ".env" });

const hf = new OpenAI({
    baseURL: "https://router.huggingface.co/v1",
    apiKey: process.env.HF_TOKEN,
});

type ServiceCard = {
    idServizio: number;
    nome: string;
    descrizione: string;
    durata: number;
    prezzo: number;
    categoria: string;
    sottocategoria: string;
    tipoPrenotazione: "sito" | "telefono" | "consulenza" | "";
};

type ProductCard = {
    idProdotto: number;
    nome: string;
    descrizione: string;
    prezzo: number;
    marca: string;
    formato: string;
    categoria: string;
    foto: string;
};

function normalizeText(text: unknown): string {
    return String(text ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[^a-z0-9'+ ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function safeString(value: unknown): string {
    return String(value ?? "").trim();
}

function squeezeRepeatedLetters(text: string): string {
    return text.replace(/([a-z])\1+/g, "$1");
}

function tokenize(text: unknown): string[] {
    return normalizeText(text).split(" ").filter(Boolean);
}

function levenshtein(a: string, b: string): number {
    const costs = Array.from({ length: b.length + 1 }, (_, index) => index);

    for (let i = 1; i <= a.length; i += 1) {
        let previous = i - 1;
        costs[0] = i;

        for (let j = 1; j <= b.length; j += 1) {
            const current = costs[j];
            costs[j] = a[i - 1] === b[j - 1]
                ? previous
                : Math.min(previous, costs[j], costs[j - 1]) + 1;
            previous = current;
        }
    }

    return costs[b.length];
}

function hasDirectTerm(text: unknown, term: string): boolean {
    const normalizedText = normalizeText(text);
    const normalizedTerm = normalizeText(term);

    if (!normalizedText || !normalizedTerm) return false;
    if (normalizedText.includes(normalizedTerm)) return true;

    return squeezeRepeatedLetters(normalizedText).includes(squeezeRepeatedLetters(normalizedTerm));
}

function hasFuzzyWord(text: unknown, term: string): boolean {
    const normalizedTerm = normalizeText(term);
    if (!normalizedTerm || normalizedTerm.includes(" ") || normalizedTerm.length < 5) return false;

    const allowedDistance = normalizedTerm.length >= 8 ? 2 : 1;
    return tokenize(text).some((word) => {
        if (Math.abs(word.length - normalizedTerm.length) > allowedDistance) return false;
        return levenshtein(word, normalizedTerm) <= allowedDistance;
    });
}

function hasAnyDirectTerm(text: unknown, terms: string[]): boolean {
    return terms.some((term) => hasDirectTerm(text, term));
}

function countDirectTerms(text: unknown, terms: string[]): number {
    return terms.reduce((count, term) => count + (hasDirectTerm(text, term) ? 1 : 0), 0);
}

function countFuzzyWords(text: unknown, terms: string[]): number {
    return terms.reduce((count, term) => count + (hasFuzzyWord(text, term) ? 1 : 0), 0);
}

function isVisibleOnSite(record: any): boolean {
    const value =
        record?.["visualizzazione sito"] ??
        record?.visualizzazioneSito ??
        record?.visualizzazione_sito ??
        record?.visualizzazione;

    return value === true || value === 1 || value === "true" || value === "t";
}

function countMatches(text: string, terms: string[]): number {
    return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function detectIntent(text: string): "servizi" | "taglio" | "colore" | "cura" | "generic" {
    const t = normalizeText(text);

    if (
        t.includes("servizi") ||
        t.includes("servizio") ||
        t.includes("cosa fate") ||
        t.includes("cosa offrite") ||
        t.includes("offrite") ||
        t.includes("quali servizi")
    ) {
        return "servizi";
    }

    if (t.includes("taglio") || t.includes("sfumatura") || t.includes("barba")) {
        return "taglio";
    }

    if (
        t.includes("colore") ||
        t.includes("tinta") ||
        t.includes("balayage") ||
        t.includes("schiar") ||
        t.includes("colpi di sole")
    ) {
        return "colore";
    }

    if (
        t.includes("trattamento") ||
        t.includes("cheratina") ||
        t.includes("ricostruzione") ||
        t.includes("anti crespo") ||
        t.includes("anticrespo")
    ) {
        return "cura";
    }

    return "generic";
}

function detectRequestType(text: string): "list" | "specific-service" | "advice" | "generic" {
    const t = normalizeText(text);

    const explicitListSignals = [
        "che servizi offrite",
        "quali servizi",
        "cosa fate",
        "cosa offrite",
        "lista servizi",
        "catalogo servizi",
        "mostrami i servizi",
        "fammi vedere i servizi"
    ];

    const adviceSignals = [
        "consigli",
        "consigliami",
        "mi consigli",
        "quale",
        "adatto",
        "adatta",
        "meglio",
        "vorrei un consiglio",
        "che servizio",
        "che colore",
        "che taglio",
        "per capelli rovinati",
        "per i miei capelli",
        "secondo te",
        "piu adatto",
        "piu adatta",
        "come si mantiene",
        "come mantenerlo",
        "come mantenerla",
        "mantenere",
        "mantiene",
        "ritocco",
        "ritoccare",
        "tonalizzare",
        "tonalizzazione"
    ];

    const specificSignals = [
        "fate",
        "avete",
        "è disponibile",
        "disponibile",
        "vorrei questo",
        "mi interessa",
        "avete anche",
        "fate anche",
        "questo tipo di servizio",
        "questo servizio",
        "questo tipo di taglio",
        "una cosa del genere"
    ];

    if (explicitListSignals.some(k => t.includes(k))) return "list";
    if (adviceSignals.some(k => t.includes(k))) return "advice";
    if (specificSignals.some(k => t.includes(k))) return "specific-service";

    return "generic";
}

function isPriceQuestion(text: string): boolean {
    const t = normalizeText(text);

    return (
        t.includes("quanto costa") ||
        t.includes("quanto costerebbe") ||
        t.includes("quanto viene") ||
        t.includes("prezzo") ||
        t.includes("costo") ||
        t.includes("costi") ||
        t.includes("quanto pago") ||
        t.includes("che prezzo ha")
    );
}

function isProductQuestion(text: string): boolean {
    const t = normalizeText(text);

    return (
        t.includes("prodotto") ||
        t.includes("prodotti") ||
        t.includes("qualcosa per") ||
        t.includes("shampoo") ||
        t.includes("balsamo") ||
        t.includes("maschera") ||
        t.includes("olio") ||
        t.includes("spray") ||
        t.includes("crema") ||
        t.includes("mousse") ||
        t.includes("cosa avete per") ||
        t.includes("che avete per") ||
        t.includes("mi consigli un prodotto") ||
        t.includes("mi consigli dei prodotti") ||
        t.includes("capelli ricci") ||
        t.includes("capelli lisci") ||
        t.includes("liscio") ||
        t.includes("lisci") ||
        t.includes("capelli crespi") ||
        t.includes("capelli secchi") ||
        t.includes("capelli rovinati") ||
        t.includes("cute sensibile")
    );
}

function hasExplicitProductIntent(text: string): boolean {
    return hasAnyDirectTerm(text, [
        "prodotto",
        "prodotti",
        "shampoo",
        "balsamo",
        "maschera",
        "olio",
        "spray",
        "crema",
        "mousse",
        "styling a casa",
        "cosa avete per",
        "che avete per",
        "mostrami i prodotti",
        "prodotti del sito"
    ]);
}

function hasExplicitServiceIntent(text: string): boolean {
    return hasAnyDirectTerm(text, [
        "servizio",
        "servizi",
        "taglio",
        "barba",
        "piega",
        "colore",
        "tinta",
        "balayage",
        "schiaritura",
        "colpi di sole",
        "trattamento",
        "cheratina",
        "ricostruzione",
        "consulenza",
        "prenotare",
        "appuntamento"
    ]);
}

function isProductFollowUp(text: string): boolean {
    const t = normalizeText(text);

    return (
        t.includes("vorrei vedere") ||
        t.includes("fammi vedere") ||
        t.includes("me li fai vedere") ||
        t.includes("me li mostri") ||
        t.includes("quelli che mi hai consigliato") ||
        t.includes("quelli che mi consigli") ||
        t.includes("ci sono sul sito") ||
        t.includes("sono sul sito") ||
        t.includes("li avete sul sito") ||
        t.includes("li trovo sul sito")
    );
}

function shouldSuggestConsultation(text: string): boolean {
    const t = normalizeText(text);
    const concernMatches = countMatches(t, [
        "ricci", "lisci", "crespi", "anticrespo", "rovinati", "secchi", "cute", "forfora",
        "caduta", "sebo", "volume", "biondo", "decolor", "trattati", "sfibrati", "danneggiati"
    ]);
    const personalizationMatches = countMatches(t, [
        "per me", "per i miei capelli", "secondo te", "nel mio caso", "che mi consigli",
        "consigliami", "piu adatto", "piu adatta", "molto", "davvero", "problema"
    ]);

    return concernMatches >= 2 || (concernMatches >= 1 && personalizationMatches >= 2);
}

function consultationNudge(): string {
    return "Per un consiglio davvero personalizzato, pero, la cosa migliore resta una consulenza in salone o un confronto diretto con gli operatori: sull'analisi del capello e del viso la componente umana conta molto.";
}

function isSiteCatalogQuestion(text: string): boolean {
    const t = normalizeText(text);

    return (
        t.includes("sito") &&
        (
            t.includes("lo avete") ||
            t.includes("l avete") ||
            t.includes("ce l avete") ||
            t.includes("avete sul vostro sito") ||
            t.includes("e sul vostro sito") ||
            t.includes("e sul sito") ||
            t.includes("si trova sul sito")
        )
    );
}

function conversationIncludesProductIntent(messages: any[]): boolean {
    return messages.some((message: any) =>
        message?.role === "user" && isProductQuestion(String(message?.content || ""))
    );
}

type ServiceAudience = "male" | "female" | "any";
type ServiceNeed =
    | "haircut"
    | "cut-beard"
    | "beard"
    | "color"
    | "lightening"
    | "styling"
    | "treatment"
    | "consultation"
    | "generic";

type ServiceProfile = {
    audience: ServiceAudience;
    need: ServiceNeed;
    wantsShort: boolean;
    forChild: boolean;
};

const maleAudienceTerms = [
    "uomo",
    "uomini",
    "maschio",
    "maschi",
    "maschile",
    "maschili",
    "ragazzo",
    "ragazzi",
    "bimbo",
    "bambino",
    "figlio",
    "marito",
    "papa",
    "padre"
];

const femaleAudienceTerms = [
    "donna",
    "donne",
    "femmina",
    "femminile",
    "femminili",
    "ragazza",
    "ragazze",
    "bimba",
    "bambina",
    "figlia",
    "moglie",
    "mamma",
    "madre"
];

const childTerms = [
    "bambino",
    "bambina",
    "bambini",
    "bambine",
    "bimbo",
    "bimba",
    "baby",
    "figlio",
    "figlia",
    "ragazzino",
    "ragazzina"
];

function serviceSearchText(service: ServiceCard): string {
    return normalizeText([
        service.nome,
        service.descrizione,
        service.categoria,
        service.sottocategoria,
        service.tipoPrenotazione
    ].join(" "));
}

function detectAudience(text: unknown): ServiceAudience {
    const maleHits =
        countDirectTerms(text, maleAudienceTerms) +
        countFuzzyWords(text, ["maschile", "maschili", "maschio"]);
    const femaleHits =
        countDirectTerms(text, femaleAudienceTerms) +
        countFuzzyWords(text, ["femminile", "femminili", "femmina"]);

    if (maleHits > femaleHits) return "male";
    if (femaleHits > maleHits) return "female";
    return "any";
}

function detectServiceAudience(service: ServiceCard): ServiceAudience {
    const haystack = serviceSearchText(service);

    if (hasDirectTerm(haystack, "barba")) return "male";
    if (hasAnyDirectTerm(haystack, maleAudienceTerms)) return "male";
    if (hasAnyDirectTerm(haystack, femaleAudienceTerms)) return "female";

    return "any";
}

function detectServiceNeed(text: unknown): ServiceNeed {
    const wantsCut = hasAnyDirectTerm(text, ["taglio", "tagliare", "spuntare", "spuntata", "corto", "corti", "scalato", "sfumatura"]);
    const wantsBeard = hasAnyDirectTerm(text, ["barba", "rasatura", "baffi"]);

    if (wantsCut && wantsBeard) return "cut-beard";
    if (wantsBeard) return "beard";

    if (hasAnyDirectTerm(text, ["balayage", "schiaritura", "schiariture", "schiarire", "meches", "colpi di sole", "decolorazione", "decolorare"])) {
        return "lightening";
    }

    if (hasAnyDirectTerm(text, ["colore", "colorazione", "tinta", "tonalizzare", "tonalizzazione", "ricrescita", "riflesso"])) {
        return "color";
    }

    if (hasAnyDirectTerm(text, ["piega", "phon", "piastra", "styling", "acconciatura", "messa in piega"])) {
        return "styling";
    }

    if (hasAnyDirectTerm(text, [
        "trattamento",
        "cheratina",
        "ricostruzione",
        "ristrutturante",
        "anticrespo",
        "anti crespo",
        "nutrizione",
        "nutriente",
        "rovinati",
        "sfibrati",
        "danneggiati",
        "secchi",
        "ricci",
        "mossi",
        "crespi",
        "cute",
        "forfora",
        "sebo",
        "caduta"
    ])) {
        return "treatment";
    }

    if (hasAnyDirectTerm(text, ["consulenza", "diagnosi", "analisi capello"])) {
        return "consultation";
    }

    if (wantsCut) return "haircut";

    return "generic";
}

function buildServiceProfile(text: unknown): ServiceProfile {
    return {
        audience: detectAudience(text),
        need: detectServiceNeed(text),
        wantsShort: hasAnyDirectTerm(text, ["corto", "corti", "short", "sfumatura", "rasato", "rasati"]),
        forChild: hasAnyDirectTerm(text, childTerms)
    };
}

function isChildService(service: ServiceCard): boolean {
    const haystack = serviceSearchText(service);
    return hasAnyDirectTerm(haystack, childTerms) || hasDirectTerm(haystack, "area baby");
}

function detectServiceNeeds(service: ServiceCard): Set<ServiceNeed> {
    const haystack = serviceSearchText(service);
    const needs = new Set<ServiceNeed>();

    if (hasAnyDirectTerm(haystack, ["taglio", "spuntata", "scalato", "sfumatura"])) {
        needs.add("haircut");
    }

    if (hasAnyDirectTerm(haystack, ["barba", "rasatura", "baffi"])) {
        needs.add("beard");
    }

    if (needs.has("haircut") && needs.has("beard")) {
        needs.add("cut-beard");
    }

    if (hasAnyDirectTerm(haystack, ["balayage", "schiar", "meches", "colpi di sole", "decolor"])) {
        needs.add("lightening");
        needs.add("color");
    }

    if (hasAnyDirectTerm(haystack, ["colore", "colorazione", "tinta", "tonalizz", "ricrescita"])) {
        needs.add("color");
    }

    if (hasAnyDirectTerm(haystack, ["piega", "phon", "piastra", "styling", "acconciatura"])) {
        needs.add("styling");
    }

    if (hasAnyDirectTerm(haystack, [
        "trattamento",
        "cheratina",
        "ricostruzione",
        "ristruttur",
        "anticrespo",
        "anti crespo",
        "nutr",
        "cute",
        "forfora"
    ])) {
        needs.add("treatment");
    }

    if (hasAnyDirectTerm(haystack, ["consulenza", "diagnosi", "analisi"])) {
        needs.add("consultation");
    }

    if (needs.size === 0) {
        needs.add("generic");
    }

    return needs;
}

function serviceNeedMatches(requestNeed: ServiceNeed, serviceNeeds: Set<ServiceNeed>): boolean {
    if (requestNeed === "generic") return true;
    if (requestNeed === "cut-beard") return serviceNeeds.has("cut-beard") || (serviceNeeds.has("haircut") && serviceNeeds.has("beard"));
    if (requestNeed === "lightening") return serviceNeeds.has("lightening");
    if (requestNeed === "color") return serviceNeeds.has("color") || serviceNeeds.has("lightening");
    if (requestNeed === "haircut") return serviceNeeds.has("haircut");
    return serviceNeeds.has(requestNeed);
}

function isAudienceMismatch(profileAudience: ServiceAudience, serviceAudience: ServiceAudience): boolean {
    return profileAudience !== "any" && serviceAudience !== "any" && profileAudience !== serviceAudience;
}

function isServiceCandidateForProfile(profile: ServiceProfile, service: ServiceCard): boolean {
    const serviceAudience = detectServiceAudience(service);
    const serviceNeeds = detectServiceNeeds(service);

    if (isChildService(service) && !profile.forChild) {
        return false;
    }

    if (isAudienceMismatch(profile.audience, serviceAudience)) {
        return false;
    }

    if (!serviceNeedMatches(profile.need, serviceNeeds)) {
        return false;
    }

    return true;
}

function buildConversationProductText(messages: any[]): string {
    const lastUserMessages = messages
        .filter((message: any) => message?.role === "user")
        .slice(-4)
        .map((message: any) => safeString(message?.content))
        .filter(Boolean);

    return normalizeText(lastUserMessages.join(" "));
}

function resolveProductQueryText(lastUser: string, conversationText: string): string {
    const directConcern = detectProductConcern(lastUser);
    if (directConcern && directConcern !== "generic-products") {
        return normalizeText(lastUser);
    }

    return normalizeText(conversationText || lastUser);
}

function isSalonFollowUp(text: string): boolean {
    const t = normalizeText(text);

    return (
        t.includes("quanto dura") ||
        t.includes("durata") ||
        t.includes("quanto ci vuole") ||
        t.includes("quanto tempo") ||
        t.includes("è disponibile") ||
        t.includes("disponibile") ||
        t.includes("lo fate") ||
        t.includes("la fate") ||
        t.includes("mi interessa") ||
        t.includes("va bene") ||
        t.includes("ok") ||
        t.includes("perfetto")
    );
}

function needsMoreInfoForAdvice(text: string): boolean {
    const t = normalizeText(text);
    const profile = buildServiceProfile(t);

    const askingAdvice =
        t.includes("consigli") ||
        t.includes("consigliami") ||
        t.includes("mi consigli") ||
        t.includes("adatto") ||
        t.includes("adatta") ||
        t.includes("secondo te") ||
        t.includes("piu adatto") ||
        t.includes("che taglio");

    if (!askingAdvice) return false;

    const hasUsefulDetails =
        profile.audience !== "any" ||
        profile.wantsShort ||
        t.includes("uomo") ||
        t.includes("donna") ||
        t.includes("ricci") ||
        t.includes("mossi") ||
        t.includes("lisci") ||
        t.includes("corti") ||
        t.includes("corto") ||
        t.includes("medi") ||
        t.includes("medio") ||
        t.includes("lunghi") ||
        t.includes("lungo") ||
        t.includes("sportivo") ||
        t.includes("volum") ||
        t.includes("frangia") ||
        t.includes("rovinati") ||
        t.includes("crespi") ||
        t.includes("cute") ||
        t.includes("barba");

    return !hasUsefulDetails;
}

function buildAdviceClarificationReply(lastUser: string): string {
    const text = normalizeText(lastUser);

    if (text.includes("taglio")) {
        return "Posso darti un orientamento generale, ma per consigliarti bene devo capire qualcosa in piu: i capelli sono corti, medi o lunghi? Lisci, mossi o ricci? Preferisci un risultato facile da gestire oppure piu strutturato? Se vuoi qualcosa di davvero su misura, la consulenza in salone resta la scelta migliore.";
    }

    if (text.includes("colore") || text.includes("tinta") || text.includes("balayage")) {
        return "Posso darti un primo orientamento, ma per consigliarti bene devo capire meglio il risultato che vuoi ottenere: preferisci un effetto naturale o piu evidente? Hai gia un colore di base o capelli trattati? Per una scelta davvero precisa, meglio confrontarsi con un operatore.";
    }

    if (text.includes("trattamento") || text.includes("servizio")) {
        return "Posso indicarti un orientamento, ma prima devo capire meglio il capello: e secco, crespo, rovinato, trattato o tende a spezzarsi? Se la situazione e delicata, conviene sempre una consulenza diretta con il salone.";
    }

    return "Posso darti un consiglio generale, ma per essere davvero utile ho bisogno di qualche dettaglio in piu sul tuo tipo di capello e sul risultato che vuoi ottenere. Per una valutazione precisa, la consulenza diretta resta la strada migliore.";
}

async function getAllServices(): Promise<ServiceCard[]> {
    const { data, error } = await db
        .from("servizi")
        .select("idServizio,nome,descrizione,durata,prezzo,categoria,sottocategoria,tipoPrenotazione,visualizzazioneSito")
        .order("nome", { ascending: true });

    if (error) {
        throw error;
    }

    return ((data || []) as any[])
        .filter(isVisibleOnSite)
        .map((service) => ({
            idServizio: Number(service.idServizio),
            nome: safeString(service.nome),
            descrizione: safeString(service.descrizione),
            durata: Number(service.durata ?? 0),
            prezzo: Number(service.prezzo ?? 0),
            categoria: safeString(service.categoria),
            sottocategoria: safeString(service.sottocategoria),
            tipoPrenotazione: safeString(service.tipoPrenotazione) as ServiceCard["tipoPrenotazione"],
        }));
}

async function getAllProducts(): Promise<ProductCard[]> {
    const { data, error } = await db
        .from("prodotti")
        .select("idProdotto, nome, descrizione, prezzoRivendita, marca, formato, categoria, foto");

    if (error) {
        throw error;
    }

    return (data || []).map((product: any) => ({
        idProdotto: Number(product.idProdotto),
        nome: safeString(product.nome),
        descrizione: safeString(product.descrizione),
        prezzo: Number(product.prezzoRivendita ?? 0),
        marca: safeString(product.marca),
        formato: safeString(product.formato),
        categoria: safeString(product.categoria),
        foto: safeString(product.foto)
    }));
}

function serviceKeywords(): string[] {
    return [
        "taglio",
        "uomo",
        "donna",
        "barba",
        "sfumatura",
        "piega",
        "colore",
        "tinta",
        "balayage",
        "schiaritura",
        "schiariture",
        "colpi di sole",
        "shampoo",
        "trattamento",
        "cheratina",
        "ricostruzione",
        "ristrutturante",
        "anticrespo",
        "anti crespo"
    ];
}

function productKeywords(): string[] {
    return [
        "prodotto",
        "prodotti",
        "shampoo",
        "balsamo",
        "maschera",
        "olio",
        "spray",
        "mousse",
        "crema",
        "styling",
        "ricci",
        "curl",
        "anticrespo",
        "volume",
        "volumizzante",
        "secco",
        "secchi",
        "rovinato",
        "rovinati",
        "cute",
        "forfora",
        "barba",
        "sole",
        "biondi",
        "viola"
    ];
}

function takeDiverseProducts(items: Array<{ product: ProductCard; score: number }>, limit: number): ProductCard[] {
    const selected: ProductCard[] = [];
    const usedBrands = new Set<string>();
    const usedKinds = new Set<string>();

    for (const item of items) {
        if (selected.length >= limit) break;

        const brandKey = normalizeText(item.product.marca || item.product.nome);
        const kindKey = getProductKind(item.product);
        if ((brandKey && usedBrands.has(brandKey)) && (kindKey && usedKinds.has(kindKey))) continue;

        selected.push(item.product);
        if (brandKey) usedBrands.add(brandKey);
        if (kindKey) usedKinds.add(kindKey);
    }

    if (selected.length < limit) {
        for (const item of items) {
            if (selected.length >= limit) break;
            if (selected.some(product => product.idProdotto === item.product.idProdotto)) continue;
            selected.push(item.product);
        }
    }

    return selected;
}

function getProductKind(product: ProductCard): string {
    const nome = normalizeText(product.nome);
    const categoria = normalizeText(product.categoria);

    if (nome.includes("shampoo") || categoria.includes("shampoo")) return "shampoo";
    if (nome.includes("balsamo") || nome.includes("conditioner") || categoria.includes("balsamo")) return "balsamo";
    if (nome.includes("maschera") || nome.includes("mask") || categoria.includes("maschera")) return "maschera";
    if (nome.includes("olio") || categoria.includes("olio")) return "olio";
    if (categoria.includes("styling") || nome.includes("spray") || nome.includes("mousse") || nome.includes("crema") || nome.includes("pasta")) return "styling";
    if (categoria.includes("trattamento")) return "trattamento";
    return categoria || "prodotto";
}

type ProductConcern =
    | "generic-products"
    | "ricci"
    | "lisci"
    | "anticrespo"
    | "rovinati"
    | "volume"
    | "cute"
    | "barba"
    | "sole"
    | "biondi"
    | "styling"
    | "shampoo"
    | "balsamo"
    | "maschera";

function detectProductConcern(text: string): ProductConcern | null {
    const t = normalizeText(text);

    if (t.includes("ricci") || t.includes("curl")) return "ricci";
    if (t.includes("lisci") || t.includes("liscio")) return "lisci";
    if (t.includes("crespi") || t.includes("anticrespo")) return "anticrespo";
    if (t.includes("rovinati") || t.includes("secchi") || t.includes("ripar") || t.includes("nutr")) return "rovinati";
    if (t.includes("volume") || t.includes("volum")) return "volume";
    if (t.includes("cute") || t.includes("forfora") || t.includes("sebo") || t.includes("caduta")) return "cute";
    if (t.includes("barba")) return "barba";
    if (t.includes("sole") || t.includes("estate")) return "sole";
    if (t.includes("biondi") || t.includes("biondo") || t.includes("viola")) return "biondi";
    if (t.includes("styling") || t.includes("fissare") || t.includes("tenuta")) return "styling";
    if (t.includes("shampoo")) return "shampoo";
    if (t.includes("balsamo")) return "balsamo";
    if (t.includes("maschera")) return "maschera";

    if (
        t.includes("che prodotti avete") ||
        t.includes("mostrami i prodotti") ||
        t.includes("mostrami alcuni prodotti") ||
        t.includes("prodotti del sito") ||
        t === "prodotti"
    ) return "generic-products";

    return null;
}

function takeDiverseServices(items: Array<{ service: ServiceCard; score: number }>, limit: number): ServiceCard[] {
    const selected: ServiceCard[] = [];
    const usedNames = new Set<string>();

    for (const item of items) {
        if (selected.length >= limit) break;

        const nameKey = normalizeText(item.service.nome).split(" ").slice(0, 2).join(" ");
        if (nameKey && usedNames.has(nameKey)) continue;

        selected.push(item.service);
        if (nameKey) usedNames.add(nameKey);
    }

    if (selected.length < limit) {
        for (const item of items) {
            if (selected.length >= limit) break;
            if (selected.some(service => service.idServizio === item.service.idServizio)) continue;
            selected.push(item.service);
        }
    }

    return selected;
}

function scoreProductMatch(userText: string, product: ProductCard): number {
    const text = normalizeText(userText);
    const nome = normalizeText(product.nome);
    const descrizione = normalizeText(product.descrizione);
    const categoria = normalizeText(product.categoria);
    const marca = normalizeText(product.marca);

    let score = 0;

    if (!text) return 0;

    if (text.includes(nome)) score += 120;

    for (const key of productKeywords()) {
        if (text.includes(key) && nome.includes(key)) score += 30;
        if (text.includes(key) && descrizione.includes(key)) score += 16;
        if (text.includes(key) && categoria.includes(key)) score += 24;
        if (text.includes(key) && marca.includes(key)) score += 12;
    }

    if (text.includes("ricci") && (nome.includes("curl") || categoria.includes("ricci") || descrizione.includes("ricci"))) {
        score += 70;
    }

    if ((text.includes("lisci") || text.includes("liscio")) && (
        nome.includes("smoothing") ||
        nome.includes("levigante") ||
        nome.includes("anticrespo") ||
        descrizione.includes("levig") ||
        descrizione.includes("anticrespo")
    )) {
        score += 68;
    }

    if ((text.includes("crespi") || text.includes("anticrespo")) && (
        nome.includes("anticrespo") ||
        nome.includes("smoothing") ||
        nome.includes("levigante") ||
        descrizione.includes("anticrespo")
    )) {
        score += 60;
    }

    if ((text.includes("rovinati") || text.includes("riparare") || text.includes("ricostruzione")) && (
        nome.includes("repair") ||
        nome.includes("recupero") ||
        nome.includes("riparat") ||
        nome.includes("nourishing") ||
        descrizione.includes("riparat") ||
        descrizione.includes("nutriente")
    )) {
        score += 60;
    }

    if ((text.includes("volume") || text.includes("volumizzare")) && (
        nome.includes("volume") ||
        nome.includes("thickener") ||
        nome.includes("mousse") ||
        nome.includes("polvere") ||
        descrizione.includes("volume")
    )) {
        score += 55;
    }

    if ((text.includes("cute") || text.includes("forfora") || text.includes("sebo") || text.includes("caduta")) && (
        nome.includes("scalpc") ||
        nome.includes("soothing") ||
        nome.includes("flakecontrol") ||
        nome.includes("oilcontrol") ||
        nome.includes("anticapelli")
    )) {
        score += 70;
    }

    if (text.includes("barba") && (nome.includes("barba") || categoria.includes("barba"))) {
        score += 80;
    }

    if ((text.includes("biondi") || text.includes("biondo") || text.includes("viola")) && (
        nome.includes("viola") ||
        nome.includes("blond") ||
        nome.includes("blondme")
    )) {
        score += 70;
    }

    if (text.includes("sole") && (nome.includes("sun") || marca.includes("bcsun"))) {
        score += 70;
    }

    if (safeString(product.foto)) {
        score += 18;
    }

    return score;
}

function scoreServiceMatch(userText: string, service: ServiceCard): number {
    const text = normalizeText(userText);
    const nome = normalizeText(service.nome);
    const descrizione = normalizeText(service.descrizione);
    const haystack = serviceSearchText(service);
    const profile = buildServiceProfile(text);
    const serviceAudience = detectServiceAudience(service);
    const serviceNeeds = detectServiceNeeds(service);

    let score = 0;

    if (!text) return 0;

    if (nome && text.includes(nome)) score += 160;

    const keywords = serviceKeywords();

    for (const key of keywords) {
        if (hasDirectTerm(text, key) && nome.includes(normalizeText(key))) score += 24;
        if (hasDirectTerm(text, key) && descrizione.includes(normalizeText(key))) score += 10;
        if (hasDirectTerm(text, key) && haystack.includes(normalizeText(key))) score += 6;
    }

    if (serviceNeedMatches(profile.need, serviceNeeds)) {
        switch (profile.need) {
            case "cut-beard":
                score += 120;
                break;
            case "haircut":
                score += 90;
                break;
            case "beard":
                score += 95;
                break;
            case "lightening":
                score += 90;
                break;
            case "color":
                score += 80;
                break;
            case "styling":
                score += 75;
                break;
            case "treatment":
                score += 80;
                break;
            case "consultation":
                score += 70;
                break;
            default:
                score += 0;
        }
    } else if (profile.need !== "generic") {
        score -= 120;
    }

    if (profile.audience !== "any") {
        if (serviceAudience === profile.audience) {
            score += 130;
        } else if (serviceAudience === "any") {
            score += 18;
        } else {
            score -= 320;
        }
    }

    if (profile.wantsShort && serviceNeeds.has("haircut")) {
        score += serviceAudience === "male" ? 36 : 18;
    }

    if (profile.forChild && isChildService(service)) {
        score += 90;
    }

    if (profile.need === "haircut" && serviceNeeds.has("beard") && !hasDirectTerm(text, "barba")) {
        score -= 45;
    }

    if (
        hasDirectTerm(text, "capelli rovinati") &&
        serviceNeeds.has("treatment")
    ) {
        score += 70;
    }

    if (
        (hasDirectTerm(text, "naturale") || hasDirectTerm(text, "schiar")) &&
        (serviceNeeds.has("lightening") || descrizione.includes("naturale"))
    ) {
        score += 45;
    }

    if (hasDirectTerm(text, "ricci") && serviceNeeds.has("treatment")) {
        score += 28;
    }

    if (hasDirectTerm(text, "crespi") && serviceNeeds.has("treatment")) {
        score += 34;
    }

    if (hasDirectTerm(text, "estivo") && serviceNeeds.has("haircut")) {
        score += 25;
    }

    if (safeString(service.tipoPrenotazione) === "sito") {
        score += 8;
    }

    return score;
}

async function getSuggestedServices(lastUser: string): Promise<ServiceCard[]> {
    const text = normalizeText(lastUser);

    try {
        const allServices = await getAllServices();
        const profile = buildServiceProfile(text);

        if (
            hasAnyDirectTerm(text, [
                "servizi",
                "servizio",
                "cosa fate",
                "cosa offrite",
                "offrite",
                "quali servizi"
            ])
        ) {
            return allServices.slice(0, 6);
        }

        if (profile.need === "generic" && profile.audience === "any") {
            return [];
        }

        const candidates = allServices
            .filter((service) => isServiceCandidateForProfile(profile, service))
            .map((service) => ({
                service,
                score: Math.max(scoreServiceMatch(text, service), 1)
            }))
            .sort((a, b) => b.score - a.score);

        return takeDiverseServices(candidates, 4);
    } catch (err) {
        return [];
    }
}

async function getBestMatchingServices(
    lastUser: string,
    mode: "list" | "specific-service" | "advice" | "generic"
): Promise<ServiceCard[]> {
    try {
        if (mode === "list") {
            const services = await getAllServices();
            return services.slice(0, 6);
        }

        const allServices = await getAllServices();
        const text = normalizeText(lastUser);
        const profile = buildServiceProfile(text);
        const filteredServices = allServices.filter(service => isServiceCandidateForProfile(profile, service));
        const sourceServices =
            filteredServices.length > 0 || profile.need !== "generic" || profile.audience !== "any"
                ? filteredServices
                : allServices;

        const scored = sourceServices
            .map(service => ({
                service,
                score: scoreServiceMatch(lastUser, service)
            }))
            .filter(item => item.score > (profile.need === "generic" && profile.audience === "any" ? 0 : 20))
            .sort((a, b) => b.score - a.score);

        if (scored.length === 0) {
            return [];
        }

        if (mode === "specific-service" || mode === "advice") {
            return [scored[0].service];
        }

        return takeDiverseServices(scored, 3);
    } catch (err) {
        return [];
    }
}

async function getBestMatchingProducts(lastUser: string): Promise<ProductCard[]> {
    try {
        const allProducts = await getAllProducts();
        const text = normalizeText(lastUser);
        const concern = detectProductConcern(text);

        if (concern === "generic-products") {
            const genericProducts = [...allProducts]
                .sort((a, b) => {
                    const photoDiff = Number(Boolean(safeString(b.foto))) - Number(Boolean(safeString(a.foto)));
                    if (photoDiff !== 0) return photoDiff;

                    const brandDiff = safeString(a.marca).localeCompare(safeString(b.marca), "it", { sensitivity: "base" });
                    if (brandDiff !== 0) return brandDiff;

                    return safeString(a.nome).localeCompare(safeString(b.nome), "it", { sensitivity: "base" });
                })
                .map(product => ({ product, score: safeString(product.foto) ? 2 : 1 }));

            return takeDiverseProducts(genericProducts, 4);
        }

        const filteredProducts = allProducts.filter(product => {
            const nome = normalizeText(product.nome);
            const descrizione = normalizeText(product.descrizione);
            const categoria = normalizeText(product.categoria);

            switch (concern) {
                case "ricci":
                    return nome.includes("curl") || categoria.includes("ricci") || descrizione.includes("ricci");
                case "lisci":
                    return nome.includes("smoothing") || nome.includes("levigante") || nome.includes("anticrespo") || descrizione.includes("levig");
                case "anticrespo":
                    return nome.includes("anticrespo") || nome.includes("smoothing") || nome.includes("levigante") || descrizione.includes("anticrespo");
                case "rovinati":
                    return nome.includes("repair") || nome.includes("recupero") || nome.includes("riparat") || nome.includes("nourishing") || descrizione.includes("riparat") || descrizione.includes("nutriente");
                case "volume":
                    return nome.includes("volume") || nome.includes("thickener") || nome.includes("mousse") || nome.includes("polvere") || descrizione.includes("volume");
                case "cute":
                    return nome.includes("scalpc") || nome.includes("soothing") || nome.includes("flakecontrol") || nome.includes("oilcontrol") || nome.includes("anticapelli");
                case "barba":
                    return nome.includes("barba") || categoria.includes("barba");
                case "sole":
                    return nome.includes("sun") || normalizeText(product.marca).includes("bcsun");
                case "biondi":
                    return nome.includes("viola") || nome.includes("blond") || nome.includes("blondme");
                case "styling":
                    return categoria.includes("styling") || nome.includes("spray") || nome.includes("mousse") || nome.includes("pasta");
                case "shampoo":
                    return nome.includes("shampoo") || categoria.includes("shampoo");
                case "balsamo":
                    return nome.includes("balsamo") || nome.includes("conditioner") || categoria.includes("balsamo");
                case "maschera":
                    return nome.includes("maschera") || nome.includes("mask") || categoria.includes("maschera");
                default:
                    return true;
            }
        });

        const sourceProducts = filteredProducts.length > 0 ? filteredProducts : allProducts;

        const scored = sourceProducts
            .map(product => ({
                product,
                score: scoreProductMatch(lastUser, product)
            }))
            .filter(item => item.score > 0)
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return Number(Boolean(safeString(b.product.foto))) - Number(Boolean(safeString(a.product.foto)));
            });

        if (scored.length > 0) {
            return takeDiverseProducts(scored, 4);
        }

        const fallbackProducts = sourceProducts.filter(product => {
            const nome = normalizeText(product.nome);
            const categoria = normalizeText(product.categoria);

            return (
                (text.includes("shampoo") && (nome.includes("shampoo") || categoria.includes("shampoo"))) ||
                (text.includes("balsamo") && (nome.includes("balsamo") || categoria.includes("balsamo"))) ||
                (text.includes("maschera") && (nome.includes("maschera") || categoria.includes("maschera"))) ||
                (text.includes("olio") && (nome.includes("olio") || categoria.includes("olio"))) ||
                (text.includes("spray") && (nome.includes("spray") || categoria.includes("styling"))) ||
                (text.includes("styling") && categoria.includes("styling"))
            );
        }).sort((a, b) =>
            Number(Boolean(safeString(b.foto))) - Number(Boolean(safeString(a.foto)))
        ).map(product => ({ product, score: safeString(product.foto) ? 2 : 1 }));

        return takeDiverseProducts(fallbackProducts, 4);
    } catch (err) {
        return [];
    }
}

function buildProductsReply(lastUser: string, products: ProductCard[]): string {
    const text = normalizeText(lastUser);
    const addConsultationNudge = shouldSuggestConsultation(lastUser);

    if (!products.length) {
        const base = "Posso aiutarti a trovare prodotti presenti sul sito, ma ho bisogno di un'indicazione piu precisa. Ad esempio: anticrespo, volume, capelli secchi, cute sensibile o capelli ricci.";
        return addConsultationNudge ? `${base} ${consultationNudge()}` : base;
    }

    if (products.length === 1) {
        const base = `Per questa esigenza, sul sito c'e un prodotto che potrebbe andare bene: ${products[0].nome}.`;
        return addConsultationNudge ? `${base} ${consultationNudge()}` : base;
    }

    if (
        text.includes("che prodotti avete") ||
        text.includes("mostrami i prodotti") ||
        text.includes("mostrami alcuni prodotti") ||
        text.includes("prodotti del sito") ||
        text === "prodotti"
    ) {
        return "Ti mostro alcuni prodotti presenti sul sito che puoi guardare subito.";
    }

    if (
        text.includes("vorrei vedere") ||
        text.includes("fammi vedere") ||
        text.includes("me li mostri") ||
        text.includes("quelli che mi hai consigliato")
    ) {
        return "Ti mostro i prodotti del sito piu coerenti con la richiesta di prima.";
    }

    if (
        text.includes("ci sono sul sito") ||
        text.includes("sono sul sito") ||
        text.includes("li avete sul sito") ||
        text.includes("li trovo sul sito")
    ) {
        return "Si, questi prodotti sono presenti sul sito e puoi aprirli direttamente dalle schede qui sotto.";
    }

    if (text.includes("ricci")) {
        const routineKinds = new Set(products.map(getProductKind));
        const base = routineKinds.has("shampoo") && (routineKinds.has("maschera") || routineKinds.has("styling"))
            ? "Per capelli ricci, ti mostro una selezione piu completa con prodotti del sito utili tra detersione, nutrimento e definizione:"
            : "Per capelli ricci, questi sono i prodotti del sito che ti consiglierei di guardare per primi:";
        return addConsultationNudge ? `${base} ${consultationNudge()}` : base;
    }

    if (text.includes("lisci") || text.includes("liscio")) {
        const base = "Per capelli lisci o per un effetto piu disciplinato, questi sono i prodotti del sito che guarderei per primi:";
        return addConsultationNudge ? `${base} ${consultationNudge()}` : base;
    }

    if (text.includes("crespi") || text.includes("anticrespo")) {
        const base = "Per gestire l'effetto crespo, questi sono i prodotti del sito che possono avere piu senso:";
        return addConsultationNudge ? `${base} ${consultationNudge()}` : base;
    }

    if (text.includes("rovinati") || text.includes("secchi") || text.includes("ripar")) {
        const base = "Per capelli secchi o danneggiati, questi sono i prodotti del sito che potrebbero fare al caso tuo:";
        return addConsultationNudge ? `${base} ${consultationNudge()}` : base;
    }

    if (text.includes("volume")) {
        const base = "Per dare piu volume e struttura, questi sono i prodotti del sito che ti farei vedere per primi:";
        return addConsultationNudge ? `${base} ${consultationNudge()}` : base;
    }

    if (text.includes("cute") || text.includes("forfora") || text.includes("sebo") || text.includes("caduta")) {
        const base = "Per la cura della cute, questi sono i prodotti del sito che possono essere piu pertinenti:";
        return addConsultationNudge ? `${base} ${consultationNudge()}` : base;
    }

    const base = "Questi sono alcuni prodotti del sito che potrebbero essere pertinenti alla tua richiesta:";
    return addConsultationNudge ? `${base} ${consultationNudge()}` : base;
}

function findServiceFromConversationContext(
    messages: any[],
    services: ServiceCard[]
): ServiceCard | null {
    if (!services.length) return null;

    const recentText = [...messages]
        .slice(-6)
        .map((m: any) => normalizeText(m?.content))
        .join(" ");

    let bestService: ServiceCard | null = null;
    let bestScore = 0;

    for (const service of services) {
        const nome = normalizeText(service.nome);
        const descrizione = normalizeText(service.descrizione);

        let score = 0;

        if (recentText.includes(nome)) score += 100;

        const words = nome.split(" ").filter(w => w.length > 2);
        for (const word of words) {
            if (recentText.includes(word)) score += 20;
        }

        const descWords = descrizione.split(" ").filter(w => w.length > 4);
        for (const word of descWords) {
            if (recentText.includes(word)) score += 5;
        }

        if (score > bestScore) {
            bestScore = score;
            bestService = service;
        }
    }

    return bestScore > 0 ? bestService : null;
}

function buildPriceReply(service: ServiceCard): string {
    const nome = safeString(service.nome);
    const prezzo = Number(service.prezzo);
    const durata = Number(service.durata);

    if (Number.isFinite(prezzo) && prezzo > 0) {
        if (Number.isFinite(durata) && durata > 0) {
            return `${nome} costa EUR ${prezzo.toFixed(2)} e ha una durata di circa ${durata} minuti.`;
        }

        return `${nome} costa EUR ${prezzo.toFixed(2)}.`;
    }

    return `Al momento non ho un prezzo disponibile per ${nome}.`;
}

function buildServicesReply(services: ServiceCard[]): string {
    if (!services.length) {
        return "Posso aiutarti su taglio, colore, barba e servizi del salone, ma al momento non ho trovato un elenco completo dei servizi disponibili.";
    }

    const formatted = services
        .map((s) => {
            const nome = safeString(s.nome);
            const descrizione = safeString(s.descrizione);
            const durata = Number(s.durata);
            const prezzo = Number(s.prezzo);

            let detail = nome;

            if (descrizione) {
                detail += `: ${descrizione}`;
            }

            if (Number.isFinite(prezzo) && prezzo > 0) {
                detail += ` (EUR ${prezzo.toFixed(2)})`;
            }

            if (Number.isFinite(durata) && durata > 0) {
                detail += `, durata ${durata} min`;
            }

            return `- ${detail}`;
        })
        .join("\n");

    return `Ecco alcuni servizi disponibili nel salone:\n${formatted}`;
}

function formatServiceMeta(service: ServiceCard): string {
    const parts: string[] = [];
    const durata = Number(service.durata);
    const prezzo = Number(service.prezzo);

    if (Number.isFinite(durata) && durata > 0) {
        parts.push(`durata circa ${durata} min`);
    }

    if (Number.isFinite(prezzo) && prezzo > 0) {
        parts.push(`prezzo EUR ${prezzo.toFixed(2)}`);
    }

    return parts.length ? ` La scheda indica ${parts.join(" e ")}.` : "";
}

function buildBookingHint(service: ServiceCard): string {
    const bookingType = normalizeText(service.tipoPrenotazione);

    if (bookingType === "telefono") {
        return " Per questo servizio e meglio contattare direttamente il salone.";
    }

    if (bookingType === "consulenza") {
        return " Per questo servizio conviene partire da una consulenza in salone.";
    }

    if (bookingType === "sito") {
        return " Puoi aprire la scheda per vedere i dettagli e procedere dal sito.";
    }

    return "";
}

function buildAdviceForService(lastUser: string, service: ServiceCard): string {
    const text = normalizeText(lastUser);
    const profile = buildServiceProfile(text);
    const serviceName = safeString(service.nome);

    if (profile.need === "haircut" && profile.audience === "male") {
        return `Ti consiglierei ${serviceName}: e' il servizio piu coerente per un taglio maschile${profile.wantsShort ? " corto" : ""}, ordinato e facile da gestire. In salone possono adattare sfumatura e lunghezze a viso e tipo di capello.`;
    }

    if (profile.need === "haircut" && profile.audience === "female") {
        return `Ti consiglierei ${serviceName}: e' pensato per costruire il taglio in base a viso, stile e capello. In salone possono decidere lunghezze, scalature e gestione quotidiana con piu precisione.`;
    }

    if (profile.need === "cut-beard") {
        return `Ti consiglierei ${serviceName}: e' la scelta piu completa quando vuoi sistemare taglio e barba nello stesso passaggio, mantenendo un risultato pulito e coordinato.`;
    }

    if (profile.need === "beard") {
        return `Ti consiglierei ${serviceName}: e' il servizio piu coerente se vuoi definire barba, contorni e ordine generale del viso.`;
    }

    if (profile.need === "lightening") {
        return `Ti consiglierei ${serviceName}: e' piu coerente se cerchi luminosita, schiariture o un effetto naturale ma curato. La resa va sempre adattata alla base e allo stato del capello.`;
    }

    if (profile.need === "color") {
        return `Ti consiglierei ${serviceName}: e' collegato alla parte colore e permette di lavorare su tonalita, ricrescita o riflessi senza inventare servizi fuori catalogo.`;
    }

    if (profile.need === "styling") {
        return `Ti consiglierei ${serviceName}: e' adatto quando vuoi un risultato ordinato, rifinito e pronto per la giornata o per un'occasione.`;
    }

    if (profile.need === "treatment") {
        return `Ti consiglierei ${serviceName}: e' piu coerente se il capello ha bisogno di nutrimento, disciplina, ricostruzione o gestione del crespo. Prima di scegliere, una valutazione del capello aiuta molto.`;
    }

    if (text.includes("mantiene") || text.includes("mantenere") || text.includes("ritocco") || text.includes("tonal")) {
        return `Per mantenere bene il risultato, ${serviceName} va considerato insieme alla frequenza dei ritocchi e ai prodotti da usare a casa. Il salone puo indicarti la cadenza piu adatta dopo aver visto il capello.`;
    }

    return `Ti consiglierei ${serviceName}: tra i servizi disponibili e quello piu vicino alla tua richiesta. La scelta finale va adattata a capello, viso e risultato desiderato.`;
}

function buildProfessionalReply(
    lastUser: string,
    services: ServiceCard[],
    mode: "list" | "specific-service" | "advice" | "generic"
): string {
    const text = normalizeText(lastUser);
    const addConsultationNudge = shouldSuggestConsultation(lastUser);

    if (mode === "list") {
        return "Ecco alcuni servizi disponibili nel salone:";
    }

    if (services.length > 0) {
        const primaryService = services[0];
        const serviceName = safeString(primaryService.nome);
        const meta = formatServiceMeta(primaryService);
        const bookingHint = buildBookingHint(primaryService);

        if (mode === "specific-service") {
            if (
                text.includes("fate") ||
                text.includes("avete") ||
                text.includes("disponibile") ||
                text.includes("avete anche") ||
                text.includes("fate anche")
            ) {
                return `Si, certo: ${serviceName} e disponibile nel salone.${meta}${bookingHint}`;
            }

            return `Certo: ${serviceName} e disponibile nel salone.${meta}${bookingHint}`;
        }

        if (mode === "advice") {
            const base = `${buildAdviceForService(lastUser, primaryService)}${meta}${bookingHint}`;
            return addConsultationNudge ? `${base} ${consultationNudge()}` : base;
        }
    }

    if (mode === "generic") {
        return "Posso aiutarti con taglio, colore, barba, prodotti e scelta del servizio piu adatto. Dimmi pure cosa stai cercando.";
    }

    return "Posso aiutarti a scegliere il servizio piu adatto in base al risultato che vuoi ottenere.";
}

router.post("/", async (req, res) => {
    try {
        const model = process.env.HF_MODEL || "katanemo/Arch-Router-1.5B:hf-inference";
        const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];


        const allServices = await getAllServices();

        const lastUser =
            safeString([...messages].reverse().find((m: any) => m?.role === "user")?.content);
        const normalizedLastUser = normalizeText(lastUser);
        const productConversationText = buildConversationProductText(messages);
        const resolvedProductQueryText = resolveProductQueryText(lastUser, productConversationText);
        const hasProductContext = conversationIncludesProductIntent(messages);
        const directProductConcern = detectProductConcern(lastUser);
        const directIntent = detectIntent(lastUser);


        const hairKeywords = [
            "capelli", "taglio", "piega", "phon", "piastra", "ricci", "lisci", "frangia", "scalato",
            "colore", "tinta", "balayage", "schiar", "meches", "colpi di sole", "decolor", "tonalizz",
            "trattamento", "cheratina", "ricostruzione", "anti crespo", "anticrespo", "cute", "forfora", "sebo",
            "shampoo", "maschera", "balsamo", "olio", "spray", "prodotto", "prodotti",
            "appuntamento", "prenot", "orari", "salone", "servizi", "servizio", "barba", "sfumatura",
            "uomo", "donna", "maschile", "femminile", "ragazzo", "ragazza", "figlio",
            "prezzo", "costo", "sito"
        ];

        const containsHairKeyword = hasAnyDirectTerm(normalizedLastUser, hairKeywords);

        const conversationContext = messages
            .map((m: any) => normalizeText(m.content))
            .join(" ");

        const contextIsHair = hasAnyDirectTerm(conversationContext, hairKeywords);
        const isHairRelated =
            containsHairKeyword ||
            isPriceQuestion(lastUser) ||
            (contextIsHair && isSalonFollowUp(lastUser));

        const genericOk = [
            "ciao",
            "salve",
            "buongiorno",
            "buonasera",
            "aiuto",
            "info",
            "informazioni",
            "cosa puoi fare",
            "cosa puoi dirmi"
        ].some(k => hasDirectTerm(normalizedLastUser, k));

        if (normalizedLastUser && !isHairRelated && !genericOk) {
            return res.json({
                reply:
                    "Posso aiutarti solo con informazioni e consigli sui servizi del salone, sui capelli, sulla barba e sui prodotti.\n" +
                    "Esempi:\n" +
                    "- Taglio e styling\n" +
                    "- Colore / Balayage\n" +
                    "- Servizi per capelli e barba\n\n" +
                    "Dimmi cosa ti interessa!",
                services: [],
                products: []
            });
        }

        if (isSiteCatalogQuestion(lastUser) && hasProductContext) {
            const products = await getBestMatchingProducts(resolvedProductQueryText);

            return res.json({
                reply: "Si, questi prodotti sono presenti sul sito e puoi aprirli direttamente dalle schede qui sotto.",
                services: [],
                products
            });
        }

        if (isSiteCatalogQuestion(lastUser)) {
            return res.json({
                reply: "Si: qui sul sito puoi vedere direttamente prodotti e servizi presenti nel catalogo. Posso mostrarti prodotti adatti a un'esigenza specifica oppure i servizi disponibili.",
                services: [],
                products: []
            });
        }

        const explicitProductIntent = hasExplicitProductIntent(lastUser);
        const explicitServiceIntent = hasExplicitServiceIntent(lastUser);
        const productFollowUpFromContext =
            hasProductContext && isProductFollowUp(lastUser) && directIntent === "generic";

        if (
            explicitProductIntent ||
            productFollowUpFromContext ||
            ((directProductConcern || isProductQuestion(lastUser)) && !explicitServiceIntent)
        ) {
            const products = await getBestMatchingProducts(resolvedProductQueryText);

            return res.json({
                reply: buildProductsReply(resolvedProductQueryText, products),
                services: [],
                products
            });
        }

        if (isPriceQuestion(lastUser)) {
            const contextualService = findServiceFromConversationContext(messages, allServices);

            if (contextualService) {
                return res.json({
                    reply: buildPriceReply(contextualService),
                    services: [contextualService],
                    products: []
                });
            }

            return res.json({
                reply: "Posso dirti il prezzo, ma devo capire a quale servizio ti riferisci. Ad esempio: taglio uomo, taglio + barba, balayage o un servizio di ricostruzione.",
                services: [],
                products: []
            });
        }

        const intent = detectIntent(lastUser);
        const requestType = detectRequestType(lastUser);

        if (requestType === "generic" && intent === "generic" && genericOk) {
            return res.json({
                reply: buildProfessionalReply(lastUser, [], "generic"),
                services: [],
                products: []
            });
        }

        if (requestType === "advice" && needsMoreInfoForAdvice(lastUser)) {
            return res.json({
                reply: buildAdviceClarificationReply(lastUser),
                services: [],
                products: []
            });
        }

        let services = await getBestMatchingServices(lastUser, requestType);
        if (!services.length) {
            services = await getSuggestedServices(lastUser);
        }

        if (requestType === "list") {
            return res.json({
                reply: "Ecco alcuni servizi disponibili nel salone:",
                services: services.slice(0, 6),
                products: []
            });
        }
        if ((requestType === "specific-service" || requestType === "advice") && services.length > 0) {
            return res.json({
                reply: buildProfessionalReply(lastUser, services, requestType),
                services: [services[0]],
                products: []
            });
        }
        if (requestType === "generic" && intent !== "generic" && services.length > 0) {
            return res.json({
                reply: buildProfessionalReply(lastUser, services, "advice"),
                services: services.slice(0, 3),
                products: []
            });
        }

        if (!process.env.HF_TOKEN) {
            return res.json({
                reply: buildProfessionalReply(lastUser, services, "generic"),
                services: services.slice(0, 3),
                products: []
            });
        }

        const servicesContext =
            services.length > 0
                ? `
SERVIZI REALI DISPONIBILI NEL SALONE:
${services
                    .map(
                        (s) =>
                            `- ${s.nome}${s.prezzo != null ? ` (EUR ${s.prezzo})` : ""}${s.durata ? `, durata: ${s.durata} minuti` : ""}${s.categoria ? `, categoria: ${s.categoria}` : ""}${s.sottocategoria ? `, sottocategoria: ${s.sottocategoria}` : ""}${s.tipoPrenotazione ? `, prenotazione: ${s.tipoPrenotazione}` : ""}${s.descrizione ? ` - ${s.descrizione}` : ""}`
                    )
                    .join("\n")}
`
                : `
SERVIZI REALI DISPONIBILI NEL SALONE:
- Nessun servizio specifico trovato per questa richiesta.
- Puoi dare consigli tecnici generici senza inventare servizi, prezzi o durata.
`;

        const system = `
Sei l’assistente ufficiale del salone "I Parrucchieri".

OBIETTIVO:
Rispondi come il consulente digitale del salone "I Parrucchieri" di Fossano. Sei specializzato nei servizi del salone, nella cura dei capelli, nella barba e nei prodotti professionali.

REGOLE:
1) Rispondi solo su capelli, barba, prodotti e servizi del salone.
2) Se l’utente chiede se un servizio è disponibile, rispondi in modo diretto, chiaro e professionale.
3) Se nel contesto è presente un servizio reale del salone, fai riferimento solo a quello e non inventarne altri.
4) Se l’utente chiede un consiglio, rispondi come un professionista del settore: concreto, competente, semplice e sicuro.
5) Non inventare prezzi, orari, disponibilità o servizi non presenti.
6) Se la domanda non riguarda il salone, i servizi, i capelli, la barba o i prodotti, dillo con chiarezza e invita a fare una domanda pertinente.
7) Se non hai dati certi, dai un consiglio tecnico generale ma realistico.
8) Usa sempre la parola "servizi" invece di "trattamenti", salvo quando stai riportando il nome reale di un servizio presente nel database.
9) Mantieni un tono elegante, competente e accogliente.
10) Risposte brevi, utili e naturali: massimo 4 righe.
11) Evita elenchi inutili quando l’utente sta chiedendo un servizio specifico.
12) Se un solo servizio è il più coerente, concentrati su quello.

${servicesContext}
`;


        const completion = await Promise.race([
            hf.chat.completions.create({
                model,
                messages: [
                    { role: "system", content: system },
                    ...messages,
                ],
                max_tokens: 220,
                temperature: 0.35,
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("HF_TIMEOUT")), 25000)
            ),
        ]);


        const reply = completion.choices?.[0]?.message?.content ?? "";

        return res.json({
            reply: reply.trim() || "Vuoi parlarmi di taglio, colore, barba o servizi del salone?",
            services,
            products: []
        });
    } catch (err: any) {
        const msg = String(err?.message || err);

        if (msg.includes("HF_TIMEOUT")) {
            return res.status(504).json({
                reply: "Sto impiegando troppo tempo a rispondere. Riprova tra qualche secondo.",
                services: [],
                products: []
            });
        }

        return res.status(500).json({
            reply: "Ho avuto un problema a rispondere. Riprova tra poco.",
            services: [],
            products: []
        });
    }
});

export default router;
