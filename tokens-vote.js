import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3001;
app.use(express.json());

// --- CORS fix: allow requests from anywhere ---
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});
// --- End CORS fix ---

let votes = {};

const VOTES_FILE = "votes.json";
if (fs.existsSync(VOTES_FILE)) {
  votes = JSON.parse(fs.readFileSync(VOTES_FILE, "utf8"));
}
function saveVotes() {
  fs.writeFileSync(VOTES_FILE, JSON.stringify(votes));
}

// --- Helius logo fetcher (uses your API key, fast, safe for up to 30 tokens) ---
const HELIUS_API_KEY = "9a7a98c9-018e-4ce1-95ea-97eb96cf2ac8";
async function getLogoFromHelius(mint) {
  try {
    const url = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
    const body = {
      jsonrpc: "2.0",
      id: "1",
      method: "getAsset",
      params: { id: mint }
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body)
    });
    const data = await resp.json();

    // Try standard metaplex v2 (preferred)
    if (
      data &&
      data.result &&
      data.result.content &&
      data.result.content.links &&
      data.result.content.links.image
    ) {
      return data.result.content.links.image;
    }
    // Try legacy metaplex
    if (
      data &&
      data.result &&
      data.result.content &&
      data.result.content.metadata &&
      data.result.content.metadata.image
    ) {
      return data.result.content.metadata.image;
    }
    return null;
  } catch (e) {
    return null; // Safe fallback
  }
}
// --- End Helius logo fetcher ---

app.get("/api/tokens-vote", async (req, res) => {
  try {
    // 1. Récupère les profils récents
    const profilesResp = await fetch("https://api.dexscreener.com/token-profiles/latest/v1");
    const profiles = await profilesResp.json();

    // 2. Filtre Solana et prend les 30 plus récents
    const solanaTokens = profiles
      .filter(token => token.chainId === "solana")
      .slice(0, 30);

    if (solanaTokens.length === 0) return res.json([]);

    // 3. Mapping profil pour retrouver infos secondaires si besoin
    const profilesMap = {};
    for (const t of solanaTokens) {
      profilesMap[t.tokenAddress] = t;
    }

    // 4. Appel de /tokens/v1/solana/ avec toutes les adresses pour stats complètes
    const addresses = solanaTokens.map(token => token.tokenAddress);
    const tokensUrl = `https://api.dexscreener.com/tokens/v1/solana/${addresses.join(",")}`;
    const tokensResp = await fetch(tokensUrl);
    const tokensData = await tokensResp.json();

    // 5. On filtre les tokens avec un volume 24h > 200 000$
    let filtered = tokensData.filter(token =>
      token.volume &&
      token.volume.h24 &&
      Number(token.volume.h24) > 200000
    );

    // 6. Mapping élargi + fallback logo (async)
    // Pour chaque token sans logo, on tente Helius
    const tokens = [];
    for (const token of filtered) {
      const profil = profilesMap[token.address] || {};
      const baseToken = token.baseToken || profil.baseToken || {};
      let logoURI =
        token.icon ||
        profil.icon ||
        profil.logoURI ||
        profil.logo ||
        profil.baseToken?.icon ||
        baseToken.icon ||
        "";

      // Si pas de logo, tente de récupérer via Helius (logo caché sur la blockchain)
      if (!logoURI) {
        logoURI = await getLogoFromHelius(token.address);
      }

      tokens.push({
        address: token.address,
        name:
          token.name ||
          profil.name ||
          profil.tokenName ||
          profil.baseTokenName ||
          profil.baseToken?.name ||
          baseToken.name ||
          "",
        symbol:
          token.symbol ||
          profil.symbol ||
          profil.tokenSymbol ||
          profil.baseTokenSymbol ||
          profil.baseToken?.symbol ||
          baseToken.symbol ||
          "",
        logoURI: logoURI || "", // Met au moins "" si rien trouvé
        volume24h: token.volume?.h24 || 0,
        votes: votes[token.address] || 0,
        price: token.price || null,
        marketcap: token.fdv || null
      });
    }

    tokens.sort((a, b) => b.votes - a.votes);

    res.json(tokens);
  } catch (e) {
    res.status(500).json({ error: "API error", details: e.message });
  }
});

app.post("/api/vote", (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: "Token address required" });

  votes[address] = (votes[address] || 0) + 1;
  saveVotes();

  res.json({ success: true, votes: votes[address] });
});

app.listen(PORT, () => {
  console.log(`Tokens vote API live on port ${PORT}`);
});
