import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import https from 'https';

const CONTENT_DIR = path.resolve(__dirname, '../content');
const LOCALES = ['es', 'ca', 'en'];

const LOCALE_NAMES: Record<string, string> = {
    es: 'Spanish',
    ca: 'Catalan',
    en: 'English',
};

interface TranslationResult {
    title: string;
    description: string;
    body: string;
}

function cleanFrontmatter(data: Record<string, any>): Record<string, any> {
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
        if (v !== undefined) {
            cleaned[k] = v;
        }
    }
    return cleaned;
}

/**
 * Call Gemini 2.0 Flash to translate title, description, and markdown body
 */
async function callGeminiTranslate(
    apiKey: string,
    sourceLocale: string,
    targetLocale: string,
    title: string,
    description: string,
    body: string
): Promise<TranslationResult> {
    const prompt = `You are a culinary translator for Jorbites, an avocado-themed recipe and food sharing platform.
Translate the following event content from ${LOCALE_NAMES[sourceLocale] || sourceLocale} to ${LOCALE_NAMES[targetLocale] || targetLocale}.

Guidelines:
- Keep the friendly, engaging culinary tone of Jorbites (Spanish, Catalan, and English recipe terminology).
- Preserve all emojis, Markdown structures (headers, bullet points, bold/italic), and links.
- Return ONLY a valid JSON object with the exact keys "title", "description", and "body". Do NOT wrap in markdown fences or backticks.

Content to translate:
TITLE: ${title || ''}
DESCRIPTION: ${description || ''}
BODY:
${body || ''}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const requestBody = JSON.stringify({
        contents: [
            {
                parts: [{ text: prompt }],
            },
        ],
        generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
        },
    });

    return new Promise((resolve, reject) => {
        const req = https.request(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody),
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        return reject(
                            new Error(`Gemini API error (HTTP ${res.statusCode}): ${data}`)
                        );
                    }
                    try {
                        const parsed = JSON.parse(data);
                        const text =
                            parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (!text) {
                            return reject(new Error('No text returned in Gemini response'));
                        }
                        const result: TranslationResult = JSON.parse(text);
                        resolve(result);
                    } catch (err: any) {
                        reject(new Error(`Failed to parse Gemini output: ${err.message}`));
                    }
                });
            }
        );

        req.on('error', (err) => reject(err));
        req.write(requestBody);
        req.end();
    });
}

export async function translateEvents(dryRun = false) {
    console.log('🌐 [translate-events] Checking for missing event translations across locales...\n');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.warn(
            '⚠️ [translate-events] GEMINI_API_KEY is not set. If any missing translations are found, source locale will be duplicated as fallback.\n'
        );
    }

    // Collect all event slugs
    const slugs = new Set<string>();
    for (const loc of LOCALES) {
        const dir = path.join(CONTENT_DIR, loc);
        if (fs.existsSync(dir)) {
            for (const file of fs.readdirSync(dir)) {
                if (file.endsWith('.md')) {
                    slugs.add(file.replace(/\.md$/, ''));
                }
            }
        }
    }

    let translatedCount = 0;
    let fallbackCount = 0;

    for (const slug of Array.from(slugs).sort()) {
        const existing: Record<string, { path: string; data: any; content: string }> = {};

        for (const loc of LOCALES) {
            const locPath = path.join(CONTENT_DIR, loc, `${slug}.md`);
            if (fs.existsSync(locPath)) {
                const parsed = matter(fs.readFileSync(locPath, 'utf8'));
                if (parsed.data.title || parsed.content.trim()) {
                    existing[loc] = { path: locPath, data: parsed.data, content: parsed.content };
                }
            }
        }

        const sourceLoc = existing['es'] ? 'es' : existing['en'] ? 'en' : existing['ca'] ? 'ca' : null;
        if (!sourceLoc) continue;

        const source = existing[sourceLoc];

        for (const targetLoc of LOCALES) {
            if (targetLoc === sourceLoc) continue;

            const targetPath = path.join(CONTENT_DIR, targetLoc, `${slug}.md`);
            const targetMissing = !existing[targetLoc];

            if (targetMissing) {
                console.log(
                    `📝 [translate-events] Missing [${targetLoc}] for "${slug}" (translating from [${sourceLoc}])...`
                );

                if (dryRun) {
                    console.log(`   (dry-run: would generate ${targetPath})`);
                    continue;
                }

                if (apiKey) {
                    try {
                        const translated = await callGeminiTranslate(
                            apiKey,
                            sourceLoc,
                            targetLoc,
                            source.data.title || '',
                            source.data.description || '',
                            source.content || ''
                        );

                        const newData = cleanFrontmatter({
                            ...source.data,
                            title: translated.title || source.data.title,
                            description: translated.description || source.data.description,
                        });

                        const newContent = matter.stringify(translated.body || source.content, newData);
                        fs.mkdirSync(path.join(CONTENT_DIR, targetLoc), { recursive: true });
                        fs.writeFileSync(targetPath, newContent);
                        console.log(`   ✅ Successfully translated into [${targetLoc}]!`);
                        translatedCount++;
                    } catch (err: any) {
                        console.error(`   ❌ Translation API failed for ${slug} -> ${targetLoc}: ${err.message}`);
                        // Fallback to duplicating source
                        const fallbackData = cleanFrontmatter({ ...source.data });
                        const fallbackContent = matter.stringify(source.content, fallbackData);
                        fs.writeFileSync(targetPath, fallbackContent);
                        fallbackCount++;
                    }
                } else {
                    // Fallback when no API key is provided
                    const fallbackData = cleanFrontmatter({ ...source.data });
                    const fallbackContent = matter.stringify(source.content, fallbackData);
                    fs.mkdirSync(path.join(CONTENT_DIR, targetLoc), { recursive: true });
                    fs.writeFileSync(targetPath, fallbackContent);
                    console.log(`   ℹ️ Copied [${sourceLoc}] to [${targetLoc}] (set GEMINI_API_KEY in GitHub Secrets for AI translation).`);
                    fallbackCount++;
                }
            }
        }
    }

    console.log(`\n🎉 [translate-events] Finished checking translations:`);
    console.log(`   - AI Translations created: ${translatedCount}`);
    console.log(`   - Fallbacks copied: ${fallbackCount}\n`);
}

if (require.main === module) {
    const isDryRun = process.argv.includes('--dry-run');
    translateEvents(isDryRun).catch((err) => {
        console.error('❌ [translate-events] Failed:', err);
        process.exit(1);
    });
}
