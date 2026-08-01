const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const MAX_INPUT_CHARS = 1800;
const ALLOWED_MODES = new Set(["teacher", "lesson", "quiz"]);
const ALLOWED_SUBJECTS = new Set(["数学","英语","语文","历史","地理","生物","物理","化学"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function extractText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function instructionsFor(mode, subject, level) {
  const levelText = {
    beginner: "学习者基础较弱，请从初中衔接开始，用非常简单的中文，步骤短而清楚。",
    highschool: "学习者正在自学高中课程，请按高中基础难度讲解。",
    challenge: "学习者希望提高难度，但仍要分步骤解释。",
  }[level] || "学习者基础较弱，请讲得简单。";

  const common = `你是“Kiki Study Space”的私人高中学习老师。科目：${subject}。${levelText}
回答必须准确、友善、鼓励，但不要空泛。默认使用简体中文；英语科目可附英文例句和美式音标。
不要假装记得服务器没有提供的历史。涉及健康、法律或金融时，明确说明这里只做学习解释，不替代专业意见。`;

  if (mode === "lesson") {
    return `${common}
生成一节10到15分钟的微课程，格式必须包括：
1. 今日课题
2. 一个核心知识点
3. 一个简单例子
4. 一道练习题（先不要给答案）
5. 学完后的自我检查
按“知识点→简单例子→练习题（先不公布答案）→等待作答”的顺序教学，总长度控制在700字以内。`;
  }
  if (mode === "quiz") {
    return `${common}
你正在出题和批改。若用户还没有作答，只出一道题，不要立即公布答案；若用户提供答案，先判断对错，再指出错误步骤、重新讲解，并给一道相似题。总长度控制在550字以内。`;
  }
  return `${common}
回答用户的问题，先给最直接的结论，再分步骤解释，必要时给一个小例子。总长度控制在600字以内。`;
}

export function GET() {
  return json({ ok: true, service: "Kiki Study Space V7 AI", model: MODEL });
}

export async function POST(request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const expectedCode = process.env.KIKI_ACCESS_CODE;

    if (!apiKey) return json({ error: "服务器还没有设置 OPENAI_API_KEY。" }, 503);
    if (!expectedCode) return json({ error: "服务器还没有设置 KIKI_ACCESS_CODE。" }, 503);

    const providedCode = request.headers.get("x-kiki-access") || "";
    if (providedCode !== expectedCode) return json({ error: "私人访问密码不正确。" }, 401);

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return json({ error: "请求格式不正确。" }, 415);

    const body = await request.json();
    const mode = String(body.mode || "teacher");
    const subject = String(body.subject || "数学");
    const level = String(body.level || "beginner");
    const message = String(body.message || "").trim();

    if (!ALLOWED_MODES.has(mode)) return json({ error: "不支持的学习模式。" }, 400);
    if (!ALLOWED_SUBJECTS.has(subject)) return json({ error: "不支持的科目。" }, 400);
    if (!message) return json({ error: "请输入问题。" }, 400);
    if (message.length > MAX_INPUT_CHARS) return json({ error: "问题太长，请缩短后再试。" }, 400);

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        instructions: instructionsFor(mode, subject, level),
        input: message,
        max_output_tokens: 900,
        store: false,
      }),
    });

    const data = await openaiResponse.json().catch(() => ({}));
    if (!openaiResponse.ok) {
      console.error("OpenAI error", openaiResponse.status, data?.error?.type);
      const safeMessage =
        openaiResponse.status === 429 ? "API额度不足或请求过多，请稍后查看余额。" :
        openaiResponse.status === 401 ? "API密钥无效，请检查 Vercel 环境变量。" :
        "AI服务暂时不可用，请稍后再试。";
      return json({ error: safeMessage }, openaiResponse.status);
    }

    const text = extractText(data);
    if (!text) return json({ error: "AI没有返回可显示的内容。" }, 502);

    return json({
      text,
      model: data.model || MODEL,
      usage: data.usage ? {
        input_tokens: data.usage.input_tokens,
        output_tokens: data.usage.output_tokens,
        total_tokens: data.usage.total_tokens,
      } : null,
    });
  } catch (error) {
    console.error("V7 function error", error?.message);
    return json({ error: "服务器处理失败，请稍后再试。" }, 500);
  }
}
