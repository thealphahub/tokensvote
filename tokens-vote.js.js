import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3001;
app.use(express.json());

let votes = {};

const VOTES_FILE = "votes.json";
if (fs.existsSync(VOTES_FILE)) {
  votes = JSON.parse(fs.readFileSync(VOTES_FILE, "utf8"));
}
function saveVotes() {
  fs.writeFileSync(VOTES_FILE, JSON.stringify(votes));
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
    const filtered = tokensData.filter(token =>
      token.volume &&
      token.volume.h24 &&
      Number(token.volume.h24) > 200000
    );

    // 6. Mapping élargi : va chercher les infos jusque dans baseToken/children
    const tokens = filtered.map(token => {
      const profil = profilesMap[token.address] || {};
      // baseToken peut exister dans certains cas
      const baseToken = token.baseToken || profil.baseToken || {};
      return {
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
        logoURI:
          token.icon ||
          profil.icon ||
          profil.logoURI ||
          profil.logo ||
          profil.baseToken?.icon ||
          baseToken.icon ||
          "",
        volume24h: token.volume?.h24 || 0,
        votes: votes[token.address] || 0,
        price: token.price || null,
        marketcap: token.fdv || null
      };
    });

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
