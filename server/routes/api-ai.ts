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
    return String(text ?? "").toLowerCase().trim();
}

function safeString(value: unknown): string {
    return String(value ?? "").trim();
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

    const askingAdvice =
        t.includes("consigli") ||
        t.includes("consigliami") ||
        t.includes("mi consigli") ||
        t.includes("adatto") ||
        t.includes("adatta") ||
        t.includes("secondo te") ||
        t.includes("più adatto") ||
        t.includes("che taglio");

    if (!askingAdvice) return false;

    const hasUsefulDetails =
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
        .select("*");

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

    let score = 0;

    if (!text) return 0;

    if (text.includes(nome)) score += 100;

    const keywords = serviceKeywords();

    for (const key of keywords) {
        if (text.includes(key) && nome.includes(key)) score += 25;
        if (text.includes(key) && descrizione.includes(key)) score += 12;
    }

    if (
        text.includes("taglio") &&
        text.includes("barba") &&
        nome.includes("taglio") &&
        nome.includes("barba")
    ) {
        score += 80;
    }

    if (
        text.includes("capelli rovinati") &&
        (
            nome.includes("trattamento") ||
            nome.includes("ricostruzione") ||
            nome.includes("ristrutturante") ||
            descrizione.includes("nutriente") ||
            descrizione.includes("rigenerante") ||
            descrizione.includes("ristruttur")
        )
    ) {
        score += 60;
    }

    if (
        (text.includes("naturale") || text.includes("schiar")) &&
        (nome.includes("balayage") || descrizione.includes("naturale") || descrizione.includes("schiar"))
    ) {
        score += 40;
    }

    if (
        text.includes("piega") &&
        (nome.includes("piega") || descrizione.includes("piega"))
    ) {
        score += 50;
    }

    if (
        text.includes("colore") &&
        (nome.includes("colore") || descrizione.includes("colorazione"))
    ) {
        score += 50;
    }

    if (
        (text.includes("ricci") || text.includes("crespi") || text.includes("rovinati")) &&
        (
            nome.includes("ricostruzione") ||
            nome.includes("anticrespo") ||
            nome.includes("tratt") ||
            descrizione.includes("ricci") ||
            descrizione.includes("crespo") ||
            descrizione.includes("nutr")
        )
    ) {
        score += 45;
    }

    if (
        (text.includes("uomo") || text.includes("maschile") || text.includes("ragazzo") || text.includes("figlio")) &&
        nome.includes("uomo")
    ) {
        score += 70;
    }

    if (
        (text.includes("donna") || text.includes("femminile") || text.includes("ragazza")) &&
        nome.includes("donna")
    ) {
        score += 70;
    }

    if (text.includes("estivo") && nome.includes("taglio")) {
        score += 25;
    }

    return score;
}

async function getSuggestedServices(lastUser: string): Promise<ServiceCard[]> {
    const text = normalizeText(lastUser);

    try {
        const allServices = await getAllServices();

        if (
            text.includes("servizi") ||
            text.includes("servizio") ||
            text.includes("cosa fate") ||
            text.includes("cosa offrite") ||
            text.includes("offrite") ||
            text.includes("quali servizi")
        ) {
            return allServices.slice(0, 6);
        }

        if (text.includes("taglio") || text.includes("sfumatura")) {
            return allServices
                .filter((service) => {
                    const nome = normalizeText(service.nome);
                    const descrizione = normalizeText(service.descrizione);
                    return (
                        nome.includes("taglio") ||
                        nome.includes("sfumatura") ||
                        descrizione.includes("taglio") ||
                        descrizione.includes("sfumatura")
                    );
                })
                .slice(0, 4);
        }

        if (text.includes("barba")) {
            return allServices
                .filter((service) => {
                    const nome = normalizeText(service.nome);
                    const descrizione = normalizeText(service.descrizione);
                    return nome.includes("barba") || descrizione.includes("barba");
                })
                .slice(0, 4);
        }

        if (
            text.includes("colore") ||
            text.includes("tinta") ||
            text.includes("balayage") ||
            text.includes("schiar") ||
            text.includes("colpi di sole")
        ) {
            return allServices
                .filter((service) => {
                    const nome = normalizeText(service.nome);
                    const descrizione = normalizeText(service.descrizione);
                    return (
                        nome.includes("colore") ||
                        nome.includes("tinta") ||
                        nome.includes("balayage") ||
                        descrizione.includes("schiar") ||
                        descrizione.includes("colpi di sole")
                    );
                })
                .slice(0, 4);
        }

        if (
            text.includes("trattamento") ||
            text.includes("cheratina") ||
            text.includes("ricostruzione") ||
            text.includes("anti crespo") ||
            text.includes("anticrespo")
        ) {
            return allServices
                .filter((service) => {
                    const nome = normalizeText(service.nome);
                    const descrizione = normalizeText(service.descrizione);
                    return (
                        nome.includes("tratt") ||
                        nome.includes("cheratina") ||
                        nome.includes("ricostruzione") ||
                        descrizione.includes("tratt") ||
                        descrizione.includes("cheratina") ||
                        descrizione.includes("ricostruzione")
                    );
                })
                .slice(0, 4);
        }

        return [];
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
        const filteredServices = allServices.filter(service => {
            const nome = normalizeText(service.nome);
            const descrizione = normalizeText(service.descrizione);

            if (text.includes("uomo") || text.includes("maschile") || text.includes("ragazzo") || text.includes("figlio")) {
                if (nome.includes("donna") || descrizione.includes("donna")) {
                    return false;
                }
            }

            if (text.includes("donna") || text.includes("femminile") || text.includes("ragazza")) {
                if (nome.includes("uomo") || descrizione.includes("uomo") || nome.includes("barba")) {
                    return false;
                }
            }

            if (!(text.includes("barba")) && nome.includes("barba") && !text.includes("uomo")) {
                return false;
            }

            return true;
        });

        const sourceServices = filteredServices.length > 0 ? filteredServices : allServices;

        const scored = sourceServices
            .map(service => ({
                service,
                score: scoreServiceMatch(lastUser, service)
            }))
            .filter(item => item.score > 0)
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
        return "Ti mostro i prodotti del sito più coerenti con la richiesta di prima.";
    }

    if (
        text.includes("ci sono sul sito") ||
        text.includes("sono sul sito") ||
        text.includes("li avete sul sito") ||
        text.includes("li trovo sul sito")
    ) {
        return "Sì, questi prodotti sono presenti sul sito e puoi aprirli direttamente dalle schede qui sotto.";
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
            return `${nome} costa € ${prezzo.toFixed(2)} e ha una durata di circa ${durata} minuti.`;
        }

        return `${nome} costa € ${prezzo.toFixed(2)}.`;
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
                detail += ` (€ ${prezzo.toFixed(2)})`;
            }

            if (Number.isFinite(durata) && durata > 0) {
                detail += `, durata ${durata} min`;
            }

            return `- ${detail}`;
        })
        .join("\n");

    return `Ecco alcuni servizi disponibili nel salone:\n${formatted}`;
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
        const serviceName = safeString(services[0].nome);

        if (mode === "specific-service") {
            if (
                text.includes("fate") ||
                text.includes("avete") ||
                text.includes("disponibile") ||
                text.includes("avete anche") ||
                text.includes("fate anche")
            ) {
                return `Si, certo: ${serviceName} e disponibile.`;
            }

            return `Certo: ${serviceName} e disponibile nel salone.`;
        }

        if (mode === "advice") {
            if (
                text.includes("taglio") &&
                (text.includes("uomo") || text.includes("maschile") || text.includes("ragazzo") || text.includes("figlio"))
            ) {
                const base = "Per un ragazzo, in generale conviene orientarsi su un taglio maschile pulito, fresco e facile da gestire: qualcosa che resti ordinato anche con la crescita e che sia pratico nel quotidiano, soprattutto nei mesi piu caldi.";
                return addConsultationNudge ? `${base} ${consultationNudge()}` : base;
            }

            if (text.includes("mantiene") || text.includes("mantenere") || text.includes("ritocco") || text.includes("tonal")) {
                const base = "Per mantenere bene un colore o un balayage, in generale conviene programmare i ritocchi con regolarita e usare a casa prodotti che aiutino a preservare luminosita, morbidezza e uniformita del risultato tra un appuntamento e l'altro.";
                return addConsultationNudge ? `${base} ${consultationNudge()}` : base;
            }

            if (text.includes("taglio")) {
                const base = "In generale, quando si sceglie un taglio conviene guardare tre aspetti: forma del viso, tipo di capello e tempo che si vuole dedicare ogni giorno alla gestione. Questo servizio e una base molto valida da cui partire.";
                return addConsultationNudge ? `${base} ${consultationNudge()}` : base;
            }

            if (
                text.includes("colore") ||
                text.includes("balayage") ||
                text.includes("tinta") ||
                text.includes("schiar")
            ) {
                const base = "In generale, per i servizi colore conviene scegliere in base all'effetto che vuoi ottenere, alla manutenzione che sei disposto a fare e allo stato attuale del capello. Questo servizio puo essere una scelta molto valida se vuoi un risultato curato e armonioso.";
                return addConsultationNudge ? `${base} ${consultationNudge()}` : base;
            }

            if (
                text.includes("trattamento") ||
                text.includes("rovinati") ||
                text.includes("ricostruzione") ||
                text.includes("anticrespo")
            ) {
                const base = "In generale, quando il capello e stressato o sensibilizzato conviene scegliere servizi che puntino a nutrimento, disciplina o ricostruzione in base al problema principale. Questo e uno dei servizi che puo avere senso considerare.";
                return addConsultationNudge ? `${base} ${consultationNudge()}` : base;
            }

            const base = "Questo servizio puo essere una buona base da considerare, ma la scelta migliore dipende sempre da com'e il capello e dal risultato che vuoi ottenere davvero.";
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

        if (!process.env.HF_TOKEN) {
            return res.status(500).json({
                reply: "HF_TOKEN mancante nel file .env",
                services: [],
                products: []
            });
        }

        const model = process.env.HF_MODEL || "katanemo/Arch-Router-1.5B:hf-inference";
        const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];


        const allServices = await getAllServices();

        const lastUser =
            [...messages].reverse().find((m: any) => m?.role === "user")?.content?.toLowerCase() || "";
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

        const containsHairKeyword = hairKeywords.some(k => lastUser.includes(k));

        const conversationContext = messages
            .map((m: any) => m.content?.toLowerCase() || "")
            .join(" ");

        const contextIsHair = hairKeywords.some(k => conversationContext.includes(k));
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
        ].some(k => lastUser.includes(k));

        if (lastUser && !isHairRelated && !genericOk) {
            return res.json({
                reply:
                    "Posso aiutarti solo con informazioni e consigli sui servizi del salone, sui capelli, sulla barba e sui prodotti.\n" +
                    "Esempi:\n" +
                    "• Taglio e styling\n" +
                    "• Colore / Balayage\n" +
                    "• Servizi per capelli e barba\n\n" +
                    "Dimmi cosa ti interessa!",
                services: [],
                products: []
            });
        }

        if (isSiteCatalogQuestion(lastUser) && hasProductContext) {
            const products = await getBestMatchingProducts(resolvedProductQueryText);

            return res.json({
                reply: "Sì, questi prodotti sono presenti sul sito e puoi aprirli direttamente dalle schede qui sotto.",
                services: [],
                products
            });
        }

        if (isSiteCatalogQuestion(lastUser)) {
            return res.json({
                reply: "Sì: qui sul sito puoi vedere direttamente prodotti e servizi presenti nel catalogo. Se vuoi, posso mostrarti subito prodotti adatti a un'esigenza specifica oppure i servizi disponibili.",
                services: [],
                products: []
            });
        }

        if (
            directProductConcern ||
            isProductQuestion(lastUser) ||
            (hasProductContext && isProductFollowUp(lastUser) && directIntent === "generic")
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

        const servicesContext =
            services.length > 0
                ? `
SERVIZI REALI DISPONIBILI NEL SALONE:
${services
                    .map(
                        (s) =>
                            `- ${s.nome}${s.prezzo != null ? ` (€ ${s.prezzo})` : ""}${s.durata ? `, durata: ${s.durata} minuti` : ""}${s.descrizione ? ` - ${s.descrizione}` : ""}`
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
