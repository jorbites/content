import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import https from 'https';

const LOCALES = ['es', 'ca', 'en'];
const CONTENT_DIR = path.resolve(__dirname, '../content/blogs');

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

/**
 * Call Gemini REST API for translation
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
async function callGeminiTranslateBlog(
    apiKey: string,
    sourceLocale: string,
    targetLocale: string,
    title: string,
    description: string,
    body: string
): Promise<TranslationResult> {
    const prompt = `You are a culinary writer and translator for Jorbites, a community food, recipe, and gastronomic blog.
Translate the following blog post article from ${LOCALE_NAMES[sourceLocale] || sourceLocale} to ${LOCALE_NAMES[targetLocale] || targetLocale}.

Guidelines:
- Maintain the natural, engaging, and friendly storytelling tone of the blog post.
- Preserve all Markdown elements: headers, bullet lists, bold/italic text, links, and embedded image tags (e.g. ![Alt text](/images/blogs/...)).
- You may translate the image alt text inside ![...], but DO NOT modify the image URLs or file paths inside (/images/blogs/...).
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
            console.log(`   🤖 Requesting Gemini model "${model}" for blog...`);
            return await requestGeminiModel(apiKey, model, prompt);
        } catch (err: any) {
            lastError = err;
            console.warn(`   ⚠️ Model "${model}" failed (${err.message.slice(0, 120)}), trying next candidate...`);
            continue;
        }
    }

    throw lastError || new Error('All Gemini candidate models failed for blog translation');
}

function getTargetBlogSlugs(): Set<string> {
    const args = process.argv.slice(2);
    const explicitSlug = args.find((a) => !a.startsWith('--'));
    if (explicitSlug) {
        console.log(`🎯 [translate-blogs] Processing single blog from argument: ${explicitSlug}`);
        return new Set([explicitSlug]);
    }

    if (args.includes('--all')) {
        console.log('🌐 [translate-blogs] Processing all blogs in repository (--all flag)');
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
                const m = line.trim().match(/^content\/blogs\/(?:es|ca|en)\/(.+)\.md$/);
                if (m) {
                    changedSlugs.add(m[1]);
                }
            }
            if (changedSlugs.size > 0) {
                console.log(
                    `🎯 [translate-blogs] Detected ${changedSlugs.size} changed blog(s) via git diff (${target}): ${Array.from(changedSlugs).join(', ')}`
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
            const m = file.match(/^content\/blogs\/(?:es|ca|en)\/(.+)\.md$/);
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

export async function translateBlogs(dryRun = false) {
    console.log('🌐 [translate-blogs] Checking for missing blog translations across locales...\n');

    const apiKey = process.env.GEMINI_API_KEY;

    const slugs = getTargetBlogSlugs();
    if (slugs.size === 0) {
        console.log('✅ [translate-blogs] No changed blogs to translate.\n');
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

        // Find the best source locale: candidates with non-empty title, ranked by total content length
        const candidates = Object.keys(existing).filter((loc) => {
            const e = existing[loc];
            return Boolean(e.data.title && String(e.data.title).trim().length > 0);
        });

        if (candidates.length === 0) continue;

        candidates.sort((a, b) => {
            const lenA =
                (existing[a].data.title || '').length +
                (existing[a].data.description || '').length +
                existing[a].content.trim().length;
            const lenB =
                (existing[b].data.title || '').length +
                (existing[b].data.description || '').length +
                existing[b].content.trim().length;
            return lenB - lenA;
        });

        const sourceLoc = candidates[0];
        const source = existing[sourceLoc];
        const force = process.argv.includes('--force');

        for (const targetLoc of LOCALES) {
            if (targetLoc === sourceLoc) continue;

            const targetPath = path.join(CONTENT_DIR, targetLoc, `${slug}.md`);
            const targetEntry = existing[targetLoc];
            const isFallbackCopy =
                Boolean(targetEntry) &&
                targetEntry.data.title === source.data.title &&
                targetEntry.content.trim() === source.content.trim();

            const targetNeedsTranslation =
                !targetEntry ||
                !targetEntry.data.title?.trim() ||
                !targetEntry.data.description?.trim() ||
                !targetEntry.content?.trim() ||
                isFallbackCopy ||
                force;

            if (targetNeedsTranslation) {
                console.log(
                    `📝 [translate-blogs] Translating [${targetLoc}] for blog "${slug}" from [${sourceLoc}]...`
                );

                if (dryRun) {
                    console.log(`   (dry-run: would generate ${targetPath})`);
                    continue;
                }

                if (!apiKey) {
                    throw new Error(
                        `GEMINI_API_KEY is not set. Missing translation for blog "${slug}" [${targetLoc}] cannot be generated.`
                    );
                }

                try {
                    const translated = await callGeminiTranslateBlog(
                        apiKey,
                        sourceLoc,
                        targetLoc,
                        source.data.title || '',
                        source.data.description || '',
                        source.content || ''
                    );

                    const newData = {
                        ...source.data,
                        title: translated.title || source.data.title,
                        description: translated.description || source.data.description,
                        user_id: source.data.user_id,
                        date: source.data.date || new Date().toISOString(),
                    };

                    const newContent = matter.stringify(translated.body || source.content, newData);
                    fs.mkdirSync(path.join(CONTENT_DIR, targetLoc), { recursive: true });
                    fs.writeFileSync(targetPath, newContent);
                    console.log(`   ✅ Successfully translated blog into [${targetLoc}]!`);
                    translatedCount++;
                } catch (err: any) {
                    console.error(`   ❌ Blog translation failed for "${slug}" -> [${targetLoc}]: ${err.message}`);
                    throw err;
                }
            }
        }
    }

    console.log(`\n🎉 [translate-blogs] Finished checking blog translations:`);
    console.log(`   - AI Translations created: ${translatedCount}\n`);
}

if (require.main === module) {
    const isDryRun = process.argv.includes('--dry-run');
    translateBlogs(isDryRun).catch((err) => {
        console.error('❌ [translate-blogs] Failed:', err);
        process.exit(1);
    });
}
