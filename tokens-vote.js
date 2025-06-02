import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3001;
app.use(express.json());

// --- CORS fix ---
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

let votes = {};

const VOTES_FILE = "votes.json";
if (fs.existsSync(VOTES_FILE)) {
  votes = JSON.parse(fs.readFileSync(VOTES_FILE, "utf8"));
}
function saveVotes() {
  fs.writeFileSync(VOTES_FILE, JSON.stringify(votes));
}

// --- Helius logo fetcher ---
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await resp.json();

    // Try standard metaplex v2
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
    return null;
  }
}

// --- Solscan logo fetcher ---
async function getLogoFromSolscan(mint) {
  try {
    const resp = await fetch(`https://api.solscan.io/token/meta?tokenAddress=${mint}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data && data.icon) return data.icon;
    return null;
  } catch (e) {
    return null;
  }
}

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

    // 3. Mapping profil
    const profilesMap = {};
    for (const t of solanaTokens) {
      profilesMap[t.tokenAddress] = t;
    }

    // 4. Détails Dexscreener
    const addresses = solanaTokens.map(token => token.tokenAddress);
    const tokensUrl = `https://api.dexscreener.com/tokens/v1/solana/${addresses.join(",")}`;
    const tokensResp = await fetch(tokensUrl);
    const tokensData = await tokensResp.json();

    // 5. Volume filter
    let filtered = tokensData.filter(token =>
      token.volume && token.volume.h24 && Number(token.volume.h24) > 200000
    );

    // 6. Mapping + fallback logo multi-source
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

      // Fallback Helius puis Solscan si toujours rien
      if (!logoURI) {
        logoURI = await getLogoFromHelius(token.address);
      }
      if (!logoURI) {
        logoURI = await getLogoFromSolscan(token.address);
      }
      // (Pas de placeholder ici car le front gère déjà ça)

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
        logoURI: logoURI || "", // le front peut mettre un placeholder si vide
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
