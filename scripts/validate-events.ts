import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import sharp from 'sharp';

const LOCALES = ['ca', 'en', 'es'];
const EVENTS_CONTENT_DIR = path.resolve(__dirname, '../content/events');
const EVENTS_IMAGES_DIR = path.resolve(__dirname, '../images/events');
const BADGES_DIR = path.resolve(__dirname, '../badges');
const CHALLENGES_FILE = path.resolve(__dirname, '../content/events/weekly-challenges.json');

const MAX_COVER_BYTES = 100 * 1024; // 100 KB
const MAX_COVER_DIMENSION = 850;
const EXPECTED_BADGE_SIZE = 256;

export interface ValidationIssue {
    file: string;
    message: string;
    type: 'error' | 'warning';
}

async function validateEventImage(
    relPath: string,
    imageField: string,
    issues: ValidationIssue[]
): Promise<void> {
    const cleanPath = imageField
        .replace(/^\/images\/events\//, '')
        .replace(/^\/images\//, '');
    const localFile = path.join(EVENTS_IMAGES_DIR, cleanPath);

    if (!fs.existsSync(localFile)) {
        if (!imageField.startsWith('http') && !imageField.includes('jorbites-social')) {
            issues.push({
                file: relPath,
                message: `Image referenced "${imageField}" does not exist in images/events/ directory (checked ${localFile})`,
                type: 'error',
            });
        }
        return;
    }

    if (!cleanPath.endsWith('.webp')) {
        issues.push({
            file: relPath,
            message: `Cover image "${cleanPath}" is not in .webp format`,
            type: 'warning',
        });
    }

    const stats = fs.statSync(localFile);
    if (stats.size > MAX_COVER_BYTES) {
        const sizeKb = Math.round(stats.size / 1024);
        issues.push({
            file: relPath,
            message: `Cover image "${cleanPath}" is ${sizeKb} KB (recommended: < 100 KB)`,
            type: 'warning',
        });
    }

    try {
        const meta = await sharp(localFile).metadata();
        if (meta.width && meta.width > MAX_COVER_DIMENSION) {
            issues.push({
                file: relPath,
                message: `Cover image "${cleanPath}" width is ${meta.width}px (recommended: ~750x750px)`,
                type: 'warning',
            });
        }
    } catch (err: any) {
        issues.push({
            file: relPath,
            message: `Failed to inspect image "${cleanPath}": ${err.message}`,
            type: 'error',
        });
    }
}

async function validateEventBadge(
    relPath: string,
    badgeField: string,
    issues: ValidationIssue[]
): Promise<void> {
    const cleanPath = badgeField
        .replace(/^\/badges\//, '')
        .replace(/^\//, '');
    const localFile = path.join(BADGES_DIR, cleanPath);

    if (!fs.existsSync(localFile)) {
        issues.push({
            file: relPath,
            message: `Badge referenced "${badgeField}" does not exist in badges/ directory`,
            type: 'error',
        });
        return;
    }

    if (!cleanPath.endsWith('.webp')) {
        issues.push({
            file: relPath,
            message: `Badge asset "${cleanPath}" must be in .webp format`,
            type: 'error',
        });
    }

    try {
        const meta = await sharp(localFile).metadata();
        if (meta.width !== EXPECTED_BADGE_SIZE || meta.height !== EXPECTED_BADGE_SIZE) {
            issues.push({
                file: relPath,
                message: `Badge asset "${cleanPath}" is ${meta.width}x${meta.height}px (expected: 256x256px)`,
                type: 'warning',
            });
        }
        if (!meta.hasAlpha) {
            issues.push({
                file: relPath,
                message: `Badge asset "${cleanPath}" does not appear to have an alpha channel / transparent background`,
                type: 'warning',
            });
        }
    } catch (err: any) {
        issues.push({
            file: relPath,
            message: `Failed to inspect badge "${cleanPath}": ${err.message}`,
            type: 'error',
        });
    }
}

export async function validateEvents(): Promise<ValidationIssue[]> {
    console.log('🔍 [validate-events] Validating Jorbites events markdown, media, and badges...');
    const issues: ValidationIssue[] = [];

    if (!fs.existsSync(EVENTS_CONTENT_DIR)) {
        issues.push({
            file: 'content/events',
            message: 'Events directory content/events does not exist',
            type: 'error',
        });
        return issues;
    }

    const eventSlugsByLocale: Record<string, Set<string>> = {
        ca: new Set(),
        en: new Set(),
        es: new Set(),
    };

    for (const lang of LOCALES) {
        const dir = path.join(EVENTS_CONTENT_DIR, lang);
        if (!fs.existsSync(dir)) {
            issues.push({ file: `content/events/${lang}`, message: `Missing directory for locale [${lang}]`, type: 'error' });
            continue;
        }

        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
        console.log(`  Checking ${files.length} event files in [${lang}]...`);

        for (const filename of files) {
            const slug = filename.replace(/\.md$/, '');
            eventSlugsByLocale[lang].add(slug);

            const filePath = path.join(dir, filename);
            const relPath = path.relative(path.resolve(__dirname, '..'), filePath);
            const raw = fs.readFileSync(filePath, 'utf8');

            let data: any;
            try {
                const parsed = matter(raw);
                data = parsed.data;
            } catch (err: any) {
                issues.push({ file: relPath, message: `YAML frontmatter parsing error: ${err.message}`, type: 'error' });
                continue;
            }

            // 1. Title
            if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
                issues.push({ file: relPath, message: 'Missing or empty required "title" in frontmatter', type: 'error' });
            }

            // 2. Date timezone shift checks
            if (data.date && typeof data.date === 'string' && data.date.endsWith('Z')) {
                issues.push({
                    file: relPath,
                    message: `Date "${data.date}" has UTC "Z" suffix. Recommended: YYYY-MM-DD.`,
                    type: 'warning',
                });
            }
            if (data.endDate && typeof data.endDate === 'string' && data.endDate.endsWith('Z')) {
                issues.push({
                    file: relPath,
                    message: `EndDate "${data.endDate}" has UTC "Z" suffix. Recommended: YYYY-MM-DDTHH:mm:ss.`,
                    type: 'warning',
                });
            }

            // 3. Recurrent event checks
            if (data.recurrent && data.dayOfMonth !== undefined && data.dayOfMonth !== null) {
                const day = Number(data.dayOfMonth);
                if (isNaN(day) || day < 1 || day > 31) {
                    issues.push({ file: relPath, message: `"dayOfMonth" must be between 1 and 31 (got ${data.dayOfMonth})`, type: 'error' });
                }
            }

            // 4. Image validation
            if (data.image) {
                await validateEventImage(relPath, String(data.image), issues);
            }

            // 5. Badge validation
            if (data.badge) {
                await validateEventBadge(relPath, String(data.badge), issues);
            }
        }
    }

    // Weekly challenges schema
    if (fs.existsSync(CHALLENGES_FILE)) {
        try {
            const json = JSON.parse(fs.readFileSync(CHALLENGES_FILE, 'utf8'));
            const requiredCategories = [
                'ingredientChallenges',
                'cuisineChallenges',
                'recipeChallenges',
                'techniqueChallenges',
                'dietaryChallenges',
            ];
            for (const cat of requiredCategories) {
                if (!Array.isArray(json[cat])) {
                    issues.push({
                        file: 'content/events/weekly-challenges.json',
                        message: `Missing or non-array category: ${cat}`,
                        type: 'error',
                    });
                }
            }
        } catch (err: any) {
            issues.push({
                file: 'content/events/weekly-challenges.json',
                message: `JSON syntax error: ${err.message}`,
                type: 'error',
            });
        }
    }

    return issues;
}

if (require.main === module) {
    validateEvents().then((issues) => {
        const errors = issues.filter((i) => i.type === 'error');
        const warnings = issues.filter((i) => i.type === 'warning');

        if (warnings.length > 0) {
            console.log(`\n⚠️  ${warnings.length} Events Warning(s):`);
            for (const w of warnings.slice(0, 10)) {
                console.log(`   - ${w.file}: ${w.message}`);
            }
            if (warnings.length > 10) {
                console.log(`   ... and ${warnings.length - 10} more warnings.`);
            }
        }

        if (errors.length > 0) {
            console.error(`\n❌ Events validation failed with ${errors.length} error(s):\n`);
            for (const e of errors) {
                console.error(`   - ${e.file}: ${e.message}`);
            }
            process.exit(1);
        } else {
            console.log('\n✅ All event markdown files, images, badges, and challenges passed validation!\n');
            process.exit(0);
        }
    }).catch((err) => {
        console.error('Fatal event validation error:', err);
        process.exit(1);
    });
}
