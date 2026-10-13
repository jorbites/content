import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import sharp from 'sharp';
import { execSync } from 'child_process';
import {
    processCoverImage,
    generateBadgeFromCover,
} from './process-asset';

const CONTENT_DIR = path.resolve(__dirname, '../content');
const IMAGES_DIR = path.resolve(__dirname, '../images');
const BADGES_DIR = path.resolve(__dirname, '../badges');
const LOCALES = ['es', 'ca', 'en'];
const MAX_COVER_BYTES = 100 * 1024; // 100 KB

function isRembgInstalled(): boolean {
    try {
        execSync('which rembg', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
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

export async function autoProcessAssets() {
    console.log('🚀 [auto-process] Checking for images and badges to process...\n');

    // Collect all slugs across all locales
    const slugs = new Set<string>();
    for (const locale of LOCALES) {
        const locDir = path.join(CONTENT_DIR, locale);
        if (fs.existsSync(locDir)) {
            for (const file of fs.readdirSync(locDir)) {
                if (file.endsWith('.md')) {
                    slugs.add(file.replace(/\.md$/, ''));
                }
            }
        }
    }

    const rembgAvailable = isRembgInstalled();
    if (!rembgAvailable) {
        console.warn(
            '⚠️ [auto-process] "rembg" CLI not found. Missing badges will be generated in GitHub Actions CI.\n'
        );
    }

    let optimizedCoverCount = 0;
    let generatedBadgeCount = 0;
    let updatedEventsCount = 0;

    for (const slug of Array.from(slugs).sort()) {
        // Find existing files across locales
        const localeFiles: Record<string, { path: string; data: any; content: string }> = {};
        for (const loc of LOCALES) {
            const locPath = path.join(CONTENT_DIR, loc, `${slug}.md`);
            if (fs.existsSync(locPath)) {
                const parsed = matter(fs.readFileSync(locPath, 'utf8'));
                localeFiles[loc] = { path: locPath, data: parsed.data, content: parsed.content };
            }
        }

        const primaryLocale = localeFiles['es'] || localeFiles['en'] || localeFiles['ca'];
        if (!primaryLocale) continue;

        let modified = false;
        const frontmatter = { ...primaryLocale.data };

        // 1. Process Cover Image
        let rawImageRef = frontmatter.image;
        let resolvedCoverPath: string | null = null;

        if (rawImageRef) {
            const rawBase = path.basename(rawImageRef);
            const rawExt = path.extname(rawBase).toLowerCase();
            const rawName = path.parse(rawBase).name;

            // Search for candidate image file across root images/ and content/*/images/
            const candidates = [
                path.join(IMAGES_DIR, rawBase),
                path.join(IMAGES_DIR, `${slug}.webp`),
                path.join(IMAGES_DIR, `${slug}.png`),
                path.join(IMAGES_DIR, `${slug}.jpg`),
                path.join(IMAGES_DIR, `${rawName}.webp`),
                path.join(IMAGES_DIR, `${rawName}.png`),
                path.join(IMAGES_DIR, `${rawName}.jpg`),
                path.join(CONTENT_DIR, 'es/images', rawBase),
                path.join(CONTENT_DIR, 'ca/images', rawBase),
                path.join(CONTENT_DIR, 'en/images', rawBase),
            ];

            let existingFile: string | null = null;
            for (const c of candidates) {
                if (fs.existsSync(c)) {
                    existingFile = c;
                    break;
                }
            }

            if (existingFile) {
                const stats = fs.statSync(existingFile);
                const isFinalWebp = existingFile === path.join(IMAGES_DIR, `${slug}.webp`);
                const isUnder100k = stats.size <= MAX_COVER_BYTES;

                // Needs optimization if not final webp in root images/ or exceeds 100KB
                if (!isFinalWebp || !isUnder100k) {
                    console.log(`🖼️ [auto-process] Optimizing cover for "${slug}" (${path.basename(existingFile)})...`);
                    await processCoverImage(existingFile, slug);
                    optimizedCoverCount++;

                    const finalWebpPath = path.join(IMAGES_DIR, `${slug}.webp`);
                    if (existingFile !== finalWebpPath && fs.existsSync(existingFile)) {
                        fs.unlinkSync(existingFile);
                    }

                    // Clean up any duplicate uploads in content/*/images/
                    for (const loc of LOCALES) {
                        const dup = path.join(CONTENT_DIR, loc, 'images', rawBase);
                        if (fs.existsSync(dup)) {
                            fs.unlinkSync(dup);
                        }
                        const locImgDir = path.join(CONTENT_DIR, loc, 'images');
                        if (fs.existsSync(locImgDir) && fs.readdirSync(locImgDir).length === 0) {
                            fs.rmdirSync(locImgDir);
                        }
                    }

                    resolvedCoverPath = finalWebpPath;
                    frontmatter.image = `/images/events/${slug}.webp`;
                    modified = true;
                } else {
                    resolvedCoverPath = existingFile;
                    if (frontmatter.image !== `/images/events/${slug}.webp`) {
                        frontmatter.image = `/images/events/${slug}.webp`;
                        modified = true;
                    }
                }
            }
        }

        // 2. Process Badge Asset
        // Check if badge is declared and exists
        let badgeFileExists = false;
        if (frontmatter.badge) {
            const badgeBase = path.basename(frontmatter.badge);
            const badgePath = path.join(BADGES_DIR, badgeBase);
            badgeFileExists = fs.existsSync(badgePath);
        } else {
            // Check default <slug>.webp in badges/
            const defaultBadgePath = path.join(BADGES_DIR, `${slug}.webp`);
            if (fs.existsSync(defaultBadgePath)) {
                frontmatter.badge = `/badges/${slug}.webp`;
                badgeFileExists = true;
                modified = true;
            }
        }

        // If badge does not exist, auto-generate from cover image
        if (!badgeFileExists) {
            if (resolvedCoverPath && fs.existsSync(resolvedCoverPath)) {
                if (rembgAvailable) {
                    console.log(`🏅 [auto-process] Auto-generating missing badge for "${slug}"...`);
                    try {
                        await generateBadgeFromCover(resolvedCoverPath, slug);
                        frontmatter.badge = `/badges/${slug}.webp`;
                        generatedBadgeCount++;
                        modified = true;
                    } catch (err: any) {
                        console.error(`❌ [auto-process] Failed to generate badge for ${slug}: ${err.message}`);
                    }
                }
            }
        }

        // 3. Save updated frontmatter across all existing locales if changed
        if (modified) {
            updatedEventsCount++;
            for (const [loc, fileInfo] of Object.entries(localeFiles)) {
                const updatedData = cleanFrontmatter({
                    ...fileInfo.data,
                    image: frontmatter.image,
                    badge: frontmatter.badge,
                });
                const updatedContent = matter.stringify(fileInfo.content, updatedData);
                fs.writeFileSync(fileInfo.path, updatedContent);
            }
        }
    }

    console.log(`\n🎉 [auto-process] Completed:`);
    console.log(`   - Covers optimized: ${optimizedCoverCount}`);
    console.log(`   - Badges auto-generated: ${generatedBadgeCount}`);
    console.log(`   - Events updated: ${updatedEventsCount}\n`);
}

if (require.main === module) {
    autoProcessAssets().catch((err) => {
        console.error('❌ [auto-process] Failed:', err);
        process.exit(1);
    });
}
