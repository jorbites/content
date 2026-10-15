import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import sharp from 'sharp';

const LOCALES = ['ca', 'en', 'es'];
const BLOGS_CONTENT_DIR = path.resolve(__dirname, '../content/blogs');
const BLOGS_IMAGES_DIR = path.resolve(__dirname, '../images/blogs');

const MAX_IMAGE_BYTES = 100 * 1024; // 100 KB
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

export interface ValidationIssue {
    file: string;
    message: string;
    type: 'error' | 'warning';
}

async function validateBlogBodyImages(
    relPath: string,
    content: string,
    issues: ValidationIssue[]
): Promise<void> {
    const imgRegex = /!\[(.*?)\]\((.*?)\)/g;
    let match: RegExpExecArray | null;

    while ((match = imgRegex.exec(content)) !== null) {
        const altText = match[1];
        const imgUrl = match[2].trim().split(' ')[0]; // Handle any trailing title

        if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) {
            continue; // External image URL
        }

        const cleanPath = imgUrl
            .replace(/^\/images\/blogs\//, '')
            .replace(/^\/images\//, '')
            .replace(/^images\/blogs\//, '');

        const localFile = path.join(BLOGS_IMAGES_DIR, cleanPath);

        if (!fs.existsSync(localFile)) {
            issues.push({
                file: relPath,
                message: `Blog image referenced "${imgUrl}" does not exist in images/blogs/ directory`,
                type: 'error',
            });
            continue;
        }

        if (!cleanPath.endsWith('.webp')) {
            issues.push({
                file: relPath,
                message: `Blog image "${cleanPath}" is not in .webp format (recommended for performance)`,
                type: 'warning',
            });
        }

        try {
            const stats = fs.statSync(localFile);
            if (stats.size > MAX_IMAGE_BYTES) {
                const sizeKb = Math.round(stats.size / 1024);
                issues.push({
                    file: relPath,
                    message: `Blog image "${cleanPath}" is ${sizeKb} KB (recommended: < 100 KB)`,
                    type: 'warning',
                });
            }

            const meta = await sharp(localFile).metadata();
            if (meta.width && meta.width > 1200) {
                issues.push({
                    file: relPath,
                    message: `Blog image "${cleanPath}" width is ${meta.width}px (recommended: <= 1200px)`,
                    type: 'warning',
                });
            }
        } catch (err: any) {
            issues.push({
                file: relPath,
                message: `Failed to inspect blog image "${cleanPath}": ${err.message}`,
                type: 'error',
            });
        }
    }
}

export async function validateBlogs(): Promise<ValidationIssue[]> {
    console.log('🔍 [validate-blogs] Validating Jorbites blog markdown and media...');
    const issues: ValidationIssue[] = [];

    if (!fs.existsSync(BLOGS_CONTENT_DIR)) {
        issues.push({
            file: 'content/blogs',
            message: 'Blogs directory content/blogs does not exist',
            type: 'error',
        });
        return issues;
    }

    const blogSlugsByLocale: Record<string, Set<string>> = {
        ca: new Set(),
        en: new Set(),
        es: new Set(),
    };

    for (const lang of LOCALES) {
        const dir = path.join(BLOGS_CONTENT_DIR, lang);
        if (!fs.existsSync(dir)) {
            issues.push({ file: `content/blogs/${lang}`, message: `Missing directory for locale [${lang}]`, type: 'error' });
            continue;
        }

        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
        console.log(`  Checking ${files.length} blog files in [${lang}]...`);

        for (const filename of files) {
            const slug = filename.replace(/\.md$/, '');
            blogSlugsByLocale[lang].add(slug);

            const filePath = path.join(dir, filename);
            const relPath = path.relative(path.resolve(__dirname, '..'), filePath);
            const raw = fs.readFileSync(filePath, 'utf8');

            let data: any;
            let body = '';
            try {
                const parsed = matter(raw);
                data = parsed.data;
                body = parsed.content;
            } catch (err: any) {
                issues.push({ file: relPath, message: `YAML frontmatter parsing error: ${err.message}`, type: 'error' });
                continue;
            }

            // 1. Title validation
            if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
                issues.push({ file: relPath, message: 'Missing or empty required "title" in frontmatter', type: 'error' });
            }

            // 2. Description validation
            if (!data.description || typeof data.description !== 'string' || data.description.trim().length === 0) {
                issues.push({ file: relPath, message: 'Missing or empty required "description" in frontmatter', type: 'error' });
            }

            // 3. Date validation
            if (!data.date) {
                issues.push({ file: relPath, message: 'Missing required "date" in frontmatter', type: 'error' });
            }

            // 4. Author user_id validation
            if (!data.user_id || typeof data.user_id !== 'string') {
                issues.push({ file: relPath, message: 'Missing or empty required "user_id" (author ID)', type: 'error' });
            } else if (!OBJECT_ID_REGEX.test(data.user_id)) {
                issues.push({
                    file: relPath,
                    message: `Invalid "user_id" format: "${data.user_id}". Expected 24-character hexadecimal MongoDB ObjectId.`,
                    type: 'error',
                });
            }

            // 5. Body image validation
            await validateBlogBodyImages(relPath, body, issues);
        }
    }

    // Consistency check across locales
    const allSlugs = new Set([
        ...Array.from(blogSlugsByLocale.es),
        ...Array.from(blogSlugsByLocale.en),
        ...Array.from(blogSlugsByLocale.ca),
    ]);

    for (const slug of Array.from(allSlugs)) {
        for (const lang of LOCALES) {
            if (!blogSlugsByLocale[lang].has(slug)) {
                issues.push({
                    file: `content/blogs/${lang}/${slug}.md`,
                    message: `Missing blog post for locale [${lang}] (exists in other locales)`,
                    type: 'warning',
                });
            }
        }
    }

    return issues;
}

if (require.main === module) {
    validateBlogs().then((issues) => {
        const errors = issues.filter((i) => i.type === 'error');
        const warnings = issues.filter((i) => i.type === 'warning');

        if (warnings.length > 0) {
            console.log(`\n⚠️  ${warnings.length} Blog Warning(s):`);
            for (const w of warnings.slice(0, 10)) {
                console.log(`   - ${w.file}: ${w.message}`);
            }
            if (warnings.length > 10) {
                console.log(`   ... and ${warnings.length - 10} more warnings.`);
            }
        }

        if (errors.length > 0) {
            console.error(`\n❌ Blog validation failed with ${errors.length} error(s):\n`);
            for (const e of errors) {
                console.error(`   - ${e.file}: ${e.message}`);
            }
            process.exit(1);
        } else {
            console.log('\n✅ All blog markdown files and media passed validation!\n');
            process.exit(0);
        }
    }).catch((err) => {
        console.error('Fatal blog validation error:', err);
        process.exit(1);
    });
}
