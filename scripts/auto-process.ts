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

/**
 * Determine which event slugs to process.
 * Priority:
 * 1. CLI explicit slug: npm run process:auto <slug>
 * 2. CLI flag --all: process every event in repository
 * 3. Git diff: only process new or modified events in current branch / commit
 */
function getTargetSlugs(): Set<string> {
    // 1. Explicit slug passed via CLI
    const args = process.argv.slice(2);
    const explicitSlug = args.find((a) => !a.startsWith('--'));
    if (explicitSlug) {
        console.log(`🎯 [auto-process] Processing single event from argument: ${explicitSlug}`);
        return new Set([explicitSlug]);
    }

    // 2. Explicit --all flag
    if (args.includes('--all')) {
        console.log('🌐 [auto-process] Processing all events in repository (--all flag)');
        const allSlugs = new Set<string>();
        for (const loc of LOCALES) {
            const locDir = path.join(CONTENT_DIR, loc);
            if (fs.existsSync(locDir)) {
                for (const file of fs.readdirSync(locDir)) {
                    if (file.endsWith('.md')) {
                        allSlugs.add(file.replace(/\.md$/, ''));
                    }
                }
            }
        }
        return allSlugs;
    }

    // 3. Detect changed events via Git diff
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
                    `🎯 [auto-process] Detected ${changedSlugs.size} changed event(s) via git diff (${target}): ${Array.from(changedSlugs).join(', ')}`
                );
                return changedSlugs;
            }
        } catch {
            // Target branch might not exist locally, continue to next
        }
    }

    // 4. Check uncommitted working tree changes
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
            console.log(
                `🎯 [auto-process] Detected ${changedSlugs.size} uncommitted event(s): ${Array.from(changedSlugs).join(', ')}`
            );
            return changedSlugs;
        }
    } catch {}

    console.log('ℹ️ [auto-process] No changed events detected in Git. Use --all to process entire repository.');
    return new Set<string>();
}

export async function autoProcessAssets() {
    console.log('🚀 [auto-process] Starting asset optimization...\n');

    const targetSlugs = getTargetSlugs();
    if (targetSlugs.size === 0) {
        console.log('✅ [auto-process] Nothing to process.\n');
        return;
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

    for (const slug of Array.from(targetSlugs).sort()) {
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
        // ONLY generate badge if explicitly requested:
        // - frontmatter.badge === '' (contributor left badge blank in CMS for auto-generation)
        // - OR frontmatter.badge is explicitly declared but file does not exist yet
        // If frontmatter.badge is undefined/null (old contests without badges), NEVER auto-generate!
        const wantsBadge =
            frontmatter.badge === '' ||
            (typeof frontmatter.badge === 'string' && frontmatter.badge.trim() !== '');

        if (wantsBadge) {
            let badgeFileExists = false;
            if (frontmatter.badge && frontmatter.badge.trim() !== '') {
                const badgeBase = path.basename(frontmatter.badge);
                const badgePath = path.join(BADGES_DIR, badgeBase);
                badgeFileExists = fs.existsSync(badgePath);
            } else {
                const defaultBadgePath = path.join(BADGES_DIR, `${slug}.webp`);
                if (fs.existsSync(defaultBadgePath)) {
                    frontmatter.badge = `/badges/${slug}.webp`;
                    badgeFileExists = true;
                    modified = true;
                }
            }

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
