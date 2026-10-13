import express from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { getSupabaseContext } from './server/supabase';
import { reportServerError } from './server/errorReporting';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

export { app };

app.use(express.json({ limit: '4mb' }));

const requireAuthenticatedUser: RequestHandler = (req, res, next) => {
  void (async () => {
    const { data: context, error } = await getSupabaseContext(req);
    if (error || !context) {
      res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
      return;
    }

    const { data, error: userError } = await context.supabase.auth.getUser();
    if (userError || !data.user) {
      res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
      return;
    }

    res.locals.authenticatedUser = data.user;
    next();
  })().catch((error: unknown) => {
    void reportServerError(req, error, 'express-middleware');
    if (!res.headersSent) res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  });
};

// Lazy GoogleGenAI initialization
let aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not configured.');
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/supabase/me', requireAuthenticatedUser, (_req, res) => {
  return res.json({ user: res.locals.authenticatedUser });
});

// API: Enhance or generate standard geotechnical soil description
app.post('/api/gemini/enhance-soil-description', requireAuthenticatedUser, async (req, res) => {
  try {
    const { primarySoil, secondarySoil, grainSize, consistencyCompacity, color, moisture, extras, nValue } = req.body;
    const ai = getAIClient();

    const prompt = `Você é um engenheiro geotécnico especialista em ensaios de SPT e normas ABNT NBR 6484 e NBR 6502 (Classificação e terminologia de solos).
Dada a caracterização abaixo de uma amostra de solo coletada no amostrador padrão Raymond:
- Solo Principal: ${primarySoil || 'Não especificado'}
- Solo Secundário: ${secondarySoil || 'Nenhum'}
- Granulometria: ${grainSize || 'Não especificada'}
- Consistência / Compacidade informada: ${consistencyCompacity || 'Não especificada'}
- Cor: ${color || 'Não especificada'}
- Umidade: ${moisture || 'Não especificada'}
- Elementos adicionais / Detalhes: ${extras || 'Nenhum'}
- N-SPT calculado: ${nValue !== undefined ? nValue : 'N/A'}

Tarefa:
1. Gere a frase padronizada oficial e concisa conforme NBR 6484 (exemplo: "Argila silto-arenosa, média a rija, vermelha e amarela, úmida." ou "Areia fina e média com pedregulhos esparsos, pouco compacta, amarela e cinza.").
2. Valide se a consistência/compacidade condiz com o N-SPT (Argilas: N<=2 muito mole, 3-5 mole, 6-10 média, 11-19 rija, >=20 dura; Areias: N<=4 fofa, 5-8 pouco compacta, 9-18 medianamente compacta, 19-40 compacta, >40 muito compacta).
3. Forneça uma breve nota técnica geotécnica (ex: risco de recalque, permeabilidade estimada, comportamento na escavação).

Retorne em formato JSON estrito com o seguinte formato:
{
  "standardDescription": "frase formatada conforme NBR 6484",
  "sucsClassification": "código SUCS estimado (ex: CL, SM, SC, ML, SP)",
  "consistencyCompacityCorrected": "termo técnico correto se houver divergência ou o mesmo",
  "technicalNotes": "Breve comentário geotécnico de 1 a 2 frases úteis para o laudo."
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const result = JSON.parse(response.text?.trim() || '{}');
    res.json(result);
  } catch (error: any) {
    void reportServerError(req, error, 'server-api');
    res.status(500).json({ error: 'Não foi possível processar a descrição agora.' });
  }
});

// API: Geotechnical interpretation of entire borehole log
app.post('/api/gemini/interpret-profile', requireAuthenticatedUser, async (req, res) => {
  try {
    const { project, borehole, layers, waterTable, totalDepth } = req.body;
    const ai = getAIClient();

    const prompt = `Você é um engenheiro geotécnico sênior especializado em fundações e mecânica dos solos (ABNT NBR 6122 e NBR 6484).
Analise os dados completos desta sondagem a percussão SPT:

DADOS DA OBRA & FURO:
- Obra: ${project?.name || 'Não informada'}
- Cliente: ${project?.client || 'Não informado'}
- Furo: ${borehole?.number || 'SP-01'}
- Profundidade Total: ${totalDepth || borehole?.depth || 'N/A'} m
- Nível do Lençol Freático (N.A.): ${waterTable ? `${waterTable} m de profundidade` : 'Não atingido / furo seco'}

CAMADAS IDENTIFICADAS NO PERFIL:
${JSON.stringify(layers, null, 2)}

TAREFA:
Elabore um parecer técnico geotécnico conciso e fundamentado contendo:
1. Resumo estratigráfico e camadas predominantes.
2. Estimativa de capacidade de carga admissível para sapatas rasas (método empírico clássico Teixeira / Décourt-Quaresma: q_adm ≈ N/5 kgf/cm² ou N/50 MPa nas camadas competentes).
3. Avaliação para fundações profundas (estacas escavadas, hélice contínua ou pré-moldadas), indicando a cota provável de ponta / camada resistente de assentamento.
4. Impacto do nível d'água (risco de instabilidade de escavações, necessidade de rebaixamento ou esgotamento).
5. Critérios de paralisação atendidos conforme NBR 6484 (impenetrabilidade, 3m consecutivos com N>30, etc.).

Retorne em formato JSON estrito:
{
  "summary": "Resumo executivo do perfil geotécnico",
  "shallowFoundationsAnalysis": "Análise de viabilidade de sapatas/radiers com estimativa de tensão admissível (MPa e kgf/cm²)",
  "deepFoundationsAnalysis": "Recomendações para estacas/tubulões e profundidade recomendada para ponta",
  "waterTableAssessment": "Análise do lençol freático e recomendações de drenagem/escavação",
  "nbrComplianceNotes": "Observações sobre conformidade com a NBR 6484 e critérios de paralisação",
  "riskWarnings": ["Alerta 1 se houver (ex: camada mole superficial)", "Alerta 2 (ex: água próxima da superfície)"]
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const result = JSON.parse(response.text?.trim() || '{}');
    res.json(result);
  } catch (error: any) {
    void reportServerError(req, error, 'server-api');
    res.status(500).json({ error: 'Não foi possível interpretar o perfil agora.' });
  }
});

// API: Analyze soil sample photo
app.post('/api/gemini/analyze-soil-photo', requireAuthenticatedUser, async (req, res) => {
  try {
    const imageBase64 = req.body?.imageBase64;
    const imageMatch = typeof imageBase64 === 'string'
      ? imageBase64.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i)
      : null;
    if (!imageMatch) {
      return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    }
    if (imageBase64.length > 2_800_000) {
      return res.status(413).json({ error: 'A imagem excede o limite permitido de 2 MB.' });
    }

    const ai = getAIClient();

    const imagePart = {
      inlineData: {
        mimeType: imageMatch[1],
        data: imageMatch[2],
      },
    };

    const prompt = `Analise esta foto de amostra de solo de sondagem SPT ou testemunho de solo.
Identifique visualmente:
1. Tipo provável do solo (Argila, Silte, Areia, Cascalho, Solo residual ou Aterro).
2. Granulometria aparente (Fina, Média, Grossa, Pedregulhosa).
3. Cores predominantes (ex: Vermelho-amarelado, Cinza-escuro, Marrom-claro).
4. Estado aparente de umidade (Seca, Úmida, Saturada).
5. Descrição padronizada sugerida conforme NBR 6484.

Retorne em formato JSON estrito:
{
  "primarySoil": "tipo de solo",
  "secondarySoil": "solo secundário",
  "grainSize": "Fina / Média / Grossa",
  "color": "cor identificada",
  "moisture": "Seca / Úmida / Saturada",
  "suggestedDescription": "Descrição técnica formatada NBR 6484",
  "confidenceNotes": "Comentários visuais sobre a textura, grãos visíveis e homogeneidade da amostra."
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [imagePart, { text: prompt }] },
      config: {
        responseMimeType: 'application/json',
      },
    });

    const result = JSON.parse(response.text?.trim() || '{}');
    res.json(result);
  } catch (error: any) {
    void reportServerError(req, error, 'server-api');
    res.status(500).json({ error: 'Não foi possível analisar a imagem agora.' });
  }
});

const apiErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);

  const status = Number(error?.status || error?.statusCode);
  if (!Number.isInteger(status) || status >= 500) {
    void reportServerError(req, error, 'express-middleware');
  }

  if (status === 413) {
    return res.status(413).json({ error: 'A requisição excede o tamanho permitido.' });
  }
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: 'A requisição é inválida.' });
  }
  return res.status(500).json({ error: 'Erro interno. Tente novamente.' });
};

app.use(apiErrorHandler);

// Vite & Static file handling
async function setupVite() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GeoSPT AI server running on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  setupVite();
}
