import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import sharp from 'sharp';

const LANGUAGES = ['ca', 'en', 'es'];
const CONTENT_DIR = path.resolve(__dirname, '../content');
const IMAGES_DIR = path.resolve(__dirname, '../images');
const BADGES_DIR = path.resolve(__dirname, '../badges');

const MAX_COVER_BYTES = 100 * 1024; // 100 KB
const MAX_COVER_DIMENSION = 850;
const EXPECTED_BADGE_SIZE = 256;

interface ValidationIssue {
    file: string;
    message: string;
    type: 'error' | 'warning';
}

const issues: ValidationIssue[] = [];

function reportError(file: string, message: string) {
    issues.push({ file, message, type: 'error' });
}

function reportWarning(file: string, message: string) {
    issues.push({ file, message, type: 'warning' });
}

async function validateImage(
    relPath: string,
    imageField: string
): Promise<void> {
    const cleanPath = imageField
        .replace(/^\/images\/events\//, '')
        .replace(/^\/images\//, '');
    const localFile = path.join(IMAGES_DIR, cleanPath);

    if (!fs.existsSync(localFile)) {
        if (!imageField.startsWith('http') && !imageField.includes('jorbites-social')) {
            reportError(relPath, `Image referenced "${imageField}" does not exist in images/ directory`);
        }
        return;
    }

    if (!cleanPath.endsWith('.webp')) {
        reportWarning(relPath, `Cover image "${cleanPath}" is not in .webp format`);
    }

    const stats = fs.statSync(localFile);
    if (stats.size > MAX_COVER_BYTES) {
        const sizeKb = Math.round(stats.size / 1024);
        reportWarning(
            relPath,
            `Cover image "${cleanPath}" is ${sizeKb} KB (recommended: < 100 KB)`
        );
    }

    try {
        const meta = await sharp(localFile).metadata();
        if (meta.width && meta.width > MAX_COVER_DIMENSION) {
            reportWarning(
                relPath,
                `Cover image "${cleanPath}" width is ${meta.width}px (recommended: ~750x750px)`
            );
        }
    } catch (err: any) {
        reportError(relPath, `Failed to inspect image "${cleanPath}": ${err.message}`);
    }
}

async function validateBadge(
    relPath: string,
    badgeField: string
): Promise<void> {
    const cleanPath = badgeField
        .replace(/^\/badges\//, '')
        .replace(/^\//, '');
    const localFile = path.join(BADGES_DIR, cleanPath);

    if (!fs.existsSync(localFile)) {
        reportError(relPath, `Badge referenced "${badgeField}" does not exist in badges/ directory`);
        return;
    }

    if (!cleanPath.endsWith('.webp')) {
        reportError(relPath, `Badge asset "${cleanPath}" must be in .webp format`);
    }

    try {
        const meta = await sharp(localFile).metadata();
        if (meta.width !== EXPECTED_BADGE_SIZE || meta.height !== EXPECTED_BADGE_SIZE) {
            reportWarning(
                relPath,
                `Badge asset "${cleanPath}" is ${meta.width}x${meta.height}px (expected: 256x256px)`
            );
        }
        if (!meta.hasAlpha) {
            reportWarning(
                relPath,
                `Badge asset "${cleanPath}" does not appear to have transparent background (alpha channel missing)`
            );
        }
    } catch (err: any) {
        reportError(relPath, `Failed to inspect badge "${cleanPath}": ${err.message}`);
    }
}

async function runValidation() {
    console.log('🔍 Validating Jorbites events markdown, media, and badge assets...\n');

    for (const lang of LANGUAGES) {
        const dir = path.join(CONTENT_DIR, lang);
        if (!fs.existsSync(dir)) {
            reportError(dir, `Language directory not found: ${lang}`);
            continue;
        }

        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
        console.log(`  Checking ${files.length} event files in [${lang}]...`);

        for (const filename of files) {
            const filePath = path.join(dir, filename);
            const relPath = path.relative(path.resolve(__dirname, '..'), filePath);
            const raw = fs.readFileSync(filePath, 'utf8');

            let data: any;
            try {
                const parsed = matter(raw);
                data = parsed.data;
            } catch (err: any) {
                reportError(relPath, `YAML frontmatter parsing error: ${err.message}`);
                continue;
            }

            // 1. Title validation
            if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
                reportError(relPath, 'Missing or empty required "title" in frontmatter');
            }

            // 2. Date timezone shift check
            if (data.date && typeof data.date === 'string' && data.date.endsWith('Z')) {
                reportWarning(
                    relPath,
                    `Date "${data.date}" has UTC "Z" suffix which may cause timezone shifts in cron notifications. Use YYYY-MM-DD instead.`
                );
            }
            if (data.endDate && typeof data.endDate === 'string' && data.endDate.endsWith('Z')) {
                reportWarning(
                    relPath,
                    `EndDate "${data.endDate}" has UTC "Z" suffix. Recommended: YYYY-MM-DDTHH:mm:ss.`
                );
            }

            // 3. Recurrent event checks
            if (data.recurrent && data.dayOfMonth !== undefined) {
                const day = Number(data.dayOfMonth);
                if (isNaN(day) || day < 1 || day > 31) {
                    reportError(relPath, `"dayOfMonth" must be between 1 and 31 (got ${data.dayOfMonth})`);
                }
            }

            // 4. Image validation
            if (data.image) {
                await validateImage(relPath, String(data.image));
            }

            // 5. Badge validation
            if (data.badge) {
                await validateBadge(relPath, String(data.badge));
            }
        }
    }

    // Validate weekly-challenges.json
    const challengesPath = path.join(CONTENT_DIR, 'weekly-challenges.json');
    if (fs.existsSync(challengesPath)) {
        try {
            const json = JSON.parse(fs.readFileSync(challengesPath, 'utf8'));
            const requiredCategories = [
                'ingredientChallenges',
                'cuisineChallenges',
                'recipeChallenges',
                'techniqueChallenges',
                'dietaryChallenges',
            ];
            for (const cat of requiredCategories) {
                if (!Array.isArray(json[cat])) {
                    reportError('content/weekly-challenges.json', `Missing or non-array category: ${cat}`);
                }
            }
        } catch (err: any) {
            reportError('content/weekly-challenges.json', `JSON syntax error: ${err.message}`);
        }
    }

    const errors = issues.filter((i) => i.type === 'error');
    const warnings = issues.filter((i) => i.type === 'warning');

    if (warnings.length > 0) {
        console.log(`\n⚠️  ${warnings.length} Warning(s):`);
        for (const w of warnings.slice(0, 15)) {
            console.log(`   - ${w.file}: ${w.message}`);
        }
        if (warnings.length > 15) {
            console.log(`   ... and ${warnings.length - 15} more warnings.`);
        }
    }

    if (errors.length > 0) {
        console.error(`\n❌ Validation failed with ${errors.length} error(s):\n`);
        for (const e of errors) {
            console.error(`   - ${e.file}: ${e.message}`);
        }
        process.exit(1);
    } else {
        console.log('\n✅ All event markdown files, images, and badges passed validation!\n');
        process.exit(0);
    }
}

runValidation().catch((err) => {
    console.error('Fatal validation error:', err);
    process.exit(1);
});
