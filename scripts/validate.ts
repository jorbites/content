import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const LANGUAGES = ['ca', 'en', 'es'];
const CONTENT_DIR = path.resolve(__dirname, '../content');
const IMAGES_DIR = path.resolve(__dirname, '../images');

interface ValidationError {
    file: string;
    message: string;
}

const errors: ValidationError[] = [];

console.log('🔍 Validating Jorbites events markdown and media files...');

for (const lang of LANGUAGES) {
    const dir = path.join(CONTENT_DIR, lang);
    if (!fs.existsSync(dir)) {
        errors.push({ file: dir, message: 'Language directory not found' });
        continue;
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    console.log(`  Checking ${files.length} files in ${lang}...`);

    for (const filename of files) {
        const filePath = path.join(dir, filename);
        const relPath = path.relative(path.resolve(__dirname, '..'), filePath);
        const raw = fs.readFileSync(filePath, 'utf8');

        let data: any;
        try {
            const parsed = matter(raw);
            data = parsed.data;
        } catch (err: any) {
            errors.push({
                file: relPath,
                message: `YAML frontmatter parsing error: ${err.message}`,
            });
            continue;
        }

        if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
            errors.push({ file: relPath, message: 'Missing or empty required "title" in frontmatter' });
        }

        if (data.image) {
            // Strip '/images/events/' prefix if present
            const imgPath = data.image.replace(/^\/images\/events\//, '').replace(/^\/images\//, '');
            const localImgFile = path.join(IMAGES_DIR, imgPath);
            if (!fs.existsSync(localImgFile)) {
                // Warning rather than hard fail for external/social defaults
                if (!data.image.startsWith('http') && !data.image.includes('jorbites-social')) {
                    errors.push({
                        file: relPath,
                        message: `Image referenced "${data.image}" not found in images/ directory`,
                    });
                }
            }
        }

        if (data.recurrent && data.dayOfMonth) {
            const day = Number(data.dayOfMonth);
            if (isNaN(day) || day < 1 || day > 31) {
                errors.push({
                    file: relPath,
                    message: `"dayOfMonth" must be a number between 1 and 31 (got ${data.dayOfMonth})`,
                });
            }
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
                errors.push({
                    file: 'content/weekly-challenges.json',
                    message: `Missing or non-array category: ${cat}`,
                });
            }
        }
    } catch (err: any) {
        errors.push({
            file: 'content/weekly-challenges.json',
            message: `JSON syntax error: ${err.message}`,
        });
    }
}

if (errors.length > 0) {
    console.error(`\n❌ Validation failed with ${errors.length} issue(s):\n`);
    for (const err of errors) {
        console.error(`  - ${err.file}: ${err.message}`);
    }
    process.exit(1);
} else {
    console.log('\n✅ All event markdown files and weekly challenges are valid!\n');
    process.exit(0);
}
