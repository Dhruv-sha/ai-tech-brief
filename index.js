require('dotenv').config();
const Parser = require('rss-parser');
const Groq = require('groq-sdk');
const nodemailer = require("nodemailer");

const parser = new Parser();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const feeds = [
  'https://techcrunch.com/feed/',
  'https://blog.ycombinator.com/feed/',
  'https://openai.com/blog/rss.xml',
  'https://huggingface.co/blog/feed.xml'
];

function isWithinLast24Hours(dateString) {
  if (!dateString) return false;

  const articleDate = new Date(dateString);
  const now = new Date();
  const diffInMs = now - articleDate;
  const diffInHours = diffInMs / (1000 * 60 * 60);

  return diffInHours <= 24;
}

async function fetchNews() {
  let allArticles = [];

  for (const feed of feeds) {
    try {
      const parsed = await parser.parseURL(feed);

      const filtered = parsed.items
        .filter(item => isWithinLast24Hours(item.pubDate))
        .map(item => ({
          title: item.title,
          source: parsed.title,
          snippet: item.contentSnippet || "",
          link: item.link
        }));

      allArticles = allArticles.concat(filtered);
    } catch (error) {
      console.log(`Error fetching ${feed}`);
    }
  }

  return allArticles;
}

async function filterRelevantArticles(articles) {
  if (articles.length === 0) return [];

  const articleText = articles
    .map((a, i) => `${i + 1}. ${a.title} - ${a.snippet}`)
    .join("\n");

  const prompt = `
You are a tech intelligence agent.

From the list below, select ONLY articles relevant to:
- AI tools
- LLM updates
- AI infrastructure
- Startup funding
- Indian startups
- Emerging tech trends

Return only the article numbers separated by commas.
If none are relevant, return: NONE

Articles:
${articleText}
`;

  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
  });

  const response = completion.choices[0].message.content.trim();

  if (response === "NONE") return [];

  const indexes = response
    .split(",")
    .map(num => parseInt(num.trim()) - 1)
    .filter(i => !isNaN(i));

  return indexes.map(i => articles[i]);
}


async function generateDailyBrief(articles) {
  if (articles.length === 0) {
    return "No major AI or startup updates in the last 24 hours.";
  }

  const articleText = articles
    .map((a, i) => `
${i + 1}.
Title: ${a.title}
Source: ${a.source}
URL: ${a.link}
Snippet: ${a.snippet}
`)
    .join("\n");

  const prompt = `
You are a sharp AI and startup intelligence analyst.

Create a clean, concise daily brief using the articles below.

For every update you mention:
- Write a 2-3 line summary
- Add a clickable source line at the end in this format:

Source: Article Title - URL

Structure EXACTLY like this:

🔥 Top AI / Tech Updates:
- Summary
  Source: Title - URL

💰 Startup / Funding News:
- Summary
  Source: Title - URL

📈 Trend Insight:
- Observed pattern

🚀 Hidden Opportunity:
- Strategic founder insight

Keep it crisp and actionable.
Do not invent links. Only use provided URLs.

Articles:
${articleText}
`;

  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
  });

  return completion.choices[0].message.content.trim();
}



async function sendEmail(subject, content) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_USER, // sending to yourself
    subject: subject,
    html: `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; padding: 20px;">
        <h2>${subject}</h2>
        <div style="font-size: 15px;">
        ${content.replace(/\n/g, "<br>")}
        </div>
    </div>
    `,
  };

  await transporter.sendMail(mailOptions);
}


async function main() {
  console.log("Fetching fresh news...\n");

  const news = await fetchNews();
  const relevant = await filterRelevantArticles(news);
  const brief = await generateDailyBrief(relevant);

  const today = new Date().toDateString();
  const subject = `Dhruv's AI & Startup Brief – ${today}`;

  await sendEmail(subject, brief);

  console.log("✅ Email sent successfully!");
}

main();