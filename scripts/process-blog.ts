import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const BLOGS_IMAGES_DIR = path.resolve(__dirname, '../images/blogs');
const BLOGS_CONTENT_DIR = path.resolve(__dirname, '../content/blogs');
const MAX_IMAGE_BYTES = 100 * 1024; // 100 KB
const MAX_IMAGE_WIDTH = 1200;

export interface BlogProcessResult {
    outputPath: string;
    width: number;
    height: number;
    sizeKb: number;
    replacedReferencesCount?: number;
}

/**
 * Replace occurrences of old image path with new image path in all blog markdown files
 */
export function updateBlogMarkdownImageReferences(
    oldFilename: string,
    newFilename: string
): number {
    let replacedCount = 0;
    if (!fs.existsSync(BLOGS_CONTENT_DIR)) return 0;

    for (const locale of ['ca', 'en', 'es']) {
        const dir = path.join(BLOGS_CONTENT_DIR, locale);
        if (!fs.existsSync(dir)) continue;

        for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith('.md')) continue;
            const filePath = path.join(dir, file);
            const content = fs.readFileSync(filePath, 'utf8');

            const oldRef = `/images/blogs/${oldFilename}`;
            const newRef = `/images/blogs/${newFilename}`;

            if (content.includes(oldRef)) {
                const updated = content.split(oldRef).join(newRef);
                fs.writeFileSync(filePath, updated);
                replacedCount++;
                console.log(`   📝 Updated reference in ${locale}/${file}: ${oldRef} -> ${newRef}`);
            }
        }
    }
    return replacedCount;
}

/**
 * Optimize a blog image to WebP < 100KB:
 * - Resizes to max width 1200px (responsive content image)
 * - Converts to WebP
 * - Optimizes quality until < 100KB
 * - Updates markdown references if extension changed (e.g. .png -> .webp)
 */
export async function optimizeBlogImage(
    inputPath: string,
    outputBaseName?: string
): Promise<BlogProcessResult> {
    if (!fs.existsSync(inputPath)) {
        throw new Error(`Blog image not found: ${inputPath}`);
    }

    fs.mkdirSync(BLOGS_IMAGES_DIR, { recursive: true });
    const parsed = path.parse(inputPath);
    const baseName = outputBaseName || parsed.name;
    const outputPath = path.join(BLOGS_IMAGES_DIR, `${baseName}.webp`);

    let quality = 85;
    let buffer: Buffer | null = null;
    let metadata: sharp.Metadata;

    while (quality >= 10) {
        buffer = await sharp(inputPath)
            .resize({
                width: MAX_IMAGE_WIDTH,
                height: MAX_IMAGE_WIDTH,
                fit: 'inside',
                withoutEnlargement: true,
            })
            .webp({ quality, effort: 6 })
            .toBuffer();

        if (buffer.length <= MAX_IMAGE_BYTES) {
            break;
        }
        quality -= 10;
    }

    if (!buffer) {
        throw new Error(`Failed to optimize blog image: ${inputPath}`);
    }

    fs.writeFileSync(outputPath, buffer);
    metadata = await sharp(outputPath).metadata();

    const sizeKb = Math.round((buffer.length / 1024) * 10) / 10;
    console.log(`✅ Blog image optimized: ${outputPath}`);
    console.log(`   Dimensions: ${metadata.width}x${metadata.height}px`);
    console.log(`   Size: ${sizeKb} KB (quality: ${quality}%)`);

    // If original was a PNG or JPG in images/blogs, update markdown references and delete old file
    let replacedCount = 0;
    if (parsed.ext.toLowerCase() !== '.webp') {
        replacedCount = updateBlogMarkdownImageReferences(parsed.base, `${baseName}.webp`);
        if (path.resolve(inputPath) !== path.resolve(outputPath) && fs.existsSync(inputPath)) {
            fs.unlinkSync(inputPath);
            console.log(`   🗑️ Deleted old non-webp source: ${inputPath}`);
        }
    }

    return {
        outputPath,
        width: metadata.width || 0,
        height: metadata.height || 0,
        sizeKb,
        replacedReferencesCount: replacedCount,
    };
}

/**
 * Scan all images in images/blogs/ and optimize any that are non-webp or > 100KB
 */
export async function scanAndOptimizeAllBlogImages(): Promise<number> {
    if (!fs.existsSync(BLOGS_IMAGES_DIR)) return 0;

    let optimizedCount = 0;
    for (const file of fs.readdirSync(BLOGS_IMAGES_DIR)) {
        if (file.startsWith('.')) continue;
        const filePath = path.join(BLOGS_IMAGES_DIR, file);
        if (fs.statSync(filePath).isDirectory()) continue;

        const ext = path.extname(file).toLowerCase();
        const size = fs.statSync(filePath).size;

        if (ext !== '.webp' || size > MAX_IMAGE_BYTES) {
            console.log(`🔄 Optimizing blog image: ${file} (${Math.round(size / 1024)} KB)...`);
            await optimizeBlogImage(filePath);
            optimizedCount++;
        }
    }
    return optimizedCount;
}

async function runCli() {
    const args = process.argv.slice(2);

    if (args.includes('--all')) {
        console.log('🌐 Scanning and optimizing all blog images...');
        const count = await scanAndOptimizeAllBlogImages();
        console.log(`🎉 Finished optimizing ${count} blog image(s).`);
        return;
    }

    const inputPath = args[0];
    const name = args[1];

    if (!inputPath) {
        console.log('Usage:');
        console.log('  npx tsx scripts/process-blog.ts <input_image_path> [output_name]');
        console.log('  npx tsx scripts/process-blog.ts --all');
        process.exit(1);
    }

    try {
        await optimizeBlogImage(inputPath, name);
    } catch (err: any) {
        console.error('Error processing blog image:', err.message);
        process.exit(1);
    }
}

if (require.main === module) {
    runCli();
}
