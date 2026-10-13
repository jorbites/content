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
async function requestGeminiModel(
    apiKey: string,
    model: string,
    prompt: string
): Promise<TranslationResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const requestBody = JSON.stringify({
        contents: [
            {
                parts: [{ text: prompt }],
            },
        ],
        generationConfig: {
            responseMimeType: 'application/json',
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
                        const cleanText = text
                            .trim()
                            .replace(/^```(?:json)?\s*/i, '')
                            .replace(/\s*```$/i, '')
                            .trim();
                        const result: TranslationResult = JSON.parse(cleanText);
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

/**
 * Call Gemini Flash Lite (500 RPD, 15 RPM) with candidate fallback
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

    const candidateModels = [
        process.env.GEMINI_MODEL,
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-2.5-flash-lite',
    ].filter(Boolean) as string[];

    let lastError: Error | null = null;
    for (const model of candidateModels) {
        try {
            console.log(`   🤖 Requesting Gemini model "${model}"...`);
            return await requestGeminiModel(apiKey, model, prompt);
        } catch (err: any) {
            lastError = err;
            console.warn(`   ⚠️ Model "${model}" failed (${err.message.slice(0, 120)}), trying next candidate...`);
            continue;
        }
    }

    throw lastError || new Error('All Gemini candidate models failed');
}

function getTargetSlugs(): Set<string> {
    const args = process.argv.slice(2);
    const explicitSlug = args.find((a) => !a.startsWith('--'));
    if (explicitSlug) {
        console.log(`🎯 [translate-events] Processing single event from argument: ${explicitSlug}`);
        return new Set([explicitSlug]);
    }

    if (args.includes('--all')) {
        console.log('🌐 [translate-events] Processing all events in repository (--all flag)');
        const allSlugs = new Set<string>();
        for (const loc of LOCALES) {
            const dir = path.join(CONTENT_DIR, loc);
            if (fs.existsSync(dir)) {
                for (const file of fs.readdirSync(dir)) {
                    if (file.endsWith('.md')) {
                        allSlugs.add(file.replace(/\.md$/, ''));
                    }
                }
            }
        }
        return allSlugs;
    }

    const { execSync } = require('child_process');
    const changedSlugs = new Set<string>();
    const diffTargets = [
        process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}...HEAD` : null,
        'origin/main...HEAD',
        'HEAD~1...HEAD',
    ].filter(Boolean) as string[];

    for (const target of diffTargets) {
        try {
            const output = execSync(`git diff --name-only ${target}`, {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore'],
            });
            for (const line of output.split('\n')) {
                const m = line.trim().match(/^content\/(?:es|ca|en)\/(.+)\.md$/);
                if (m) {
                    changedSlugs.add(m[1]);
                }
            }
            if (changedSlugs.size > 0) {
                console.log(
                    `🎯 [translate-events] Detected ${changedSlugs.size} changed event(s) via git diff (${target}): ${Array.from(changedSlugs).join(', ')}`
                );
                return changedSlugs;
            }
        } catch {}
    }

    try {
        const status = execSync('git status --porcelain', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
        });
        for (const line of status.split('\n')) {
            const file = line.trim().slice(3).trim();
            const m = file.match(/^content\/(?:es|ca|en)\/(.+)\.md$/);
            if (m) {
                changedSlugs.add(m[1]);
            }
        }
        if (changedSlugs.size > 0) {
            return changedSlugs;
        }
    } catch {}

    return new Set<string>();
}

export async function translateEvents(dryRun = false) {
    console.log('🌐 [translate-events] Checking for missing event translations across locales...\n');

    const apiKey = process.env.GEMINI_API_KEY;

    const slugs = getTargetSlugs();
    if (slugs.size === 0) {
        console.log('✅ [translate-events] No changed events to translate.\n');
        return;
    }

    let translatedCount = 0;

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

        const force = process.argv.includes('--force');

        for (const targetLoc of LOCALES) {
            if (targetLoc === sourceLoc) continue;

            const targetPath = path.join(CONTENT_DIR, targetLoc, `${slug}.md`);
            const isFallbackCopy =
                Boolean(existing[targetLoc]) &&
                existing[targetLoc].data.title === source.data.title &&
                existing[targetLoc].content.trim() === source.content.trim();

            const targetNeedsTranslation = !existing[targetLoc] || isFallbackCopy || force;

            if (targetNeedsTranslation) {
                console.log(
                    `📝 [translate-events] Translating [${targetLoc}] for "${slug}" from [${sourceLoc}]${isFallbackCopy ? ' (replacing previous fallback)' : ''}...`
                );

                if (dryRun) {
                    console.log(`   (dry-run: would generate ${targetPath})`);
                    continue;
                }

                if (!apiKey) {
                    throw new Error(
                        `GEMINI_API_KEY is not set. Missing translation for "${slug}" [${targetLoc}] cannot be generated.`
                    );
                }

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
                    console.error(`   ❌ Translation failed for "${slug}" -> [${targetLoc}]: ${err.message}`);
                    throw err;
                }
            }
        }
    }

    console.log(`\n🎉 [translate-events] Finished checking translations:`);
    console.log(`   - AI Translations created: ${translatedCount}\n`);
}

if (require.main === module) {
    const isDryRun = process.argv.includes('--dry-run');
    translateEvents(isDryRun).catch((err) => {
        console.error('❌ [translate-events] Failed:', err);
        process.exit(1);
    });
}
