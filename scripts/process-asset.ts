import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const IMAGES_DIR = path.resolve(__dirname, '../images');
const BADGES_DIR = path.resolve(__dirname, '../badges');
const MAX_COVER_BYTES = 100 * 1024; // 100 KB
const TARGET_COVER_SIZE = 750;
const TARGET_BADGE_SIZE = 256;

interface ProcessResult {
    outputPath: string;
    width: number;
    height: number;
    sizeKb: number;
    hasAlpha?: boolean;
}

/**
 * Process a raw event cover image:
 * - Resizes to 750x750 (fit: inside)
 * - Encodes as WebP
 * - Ensures file size is < 100KB
 */
export async function processCoverImage(
    inputPath: string,
    slug: string
): Promise<ProcessResult> {
    if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file does not exist: ${inputPath}`);
    }

    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    const outputPath = path.join(IMAGES_DIR, `${slug}.webp`);

    let quality = 85;
    let buffer: Buffer | null = null;
    let metadata: sharp.Metadata;

    while (quality >= 30) {
        buffer = await sharp(inputPath)
            .resize({
                width: TARGET_COVER_SIZE,
                height: TARGET_COVER_SIZE,
                fit: 'inside',
                withoutEnlargement: false,
            })
            .webp({ quality, effort: 6 })
            .toBuffer();

        if (buffer.length <= MAX_COVER_BYTES) {
            break;
        }
        quality -= 10;
    }

    if (!buffer) {
        throw new Error(`Failed to generate WebP image for ${slug}`);
    }

    fs.writeFileSync(outputPath, buffer);
    metadata = await sharp(outputPath).metadata();

    const sizeKb = Math.round((buffer.length / 1024) * 10) / 10;
    console.log(`✅ Cover image created: ${outputPath}`);
    console.log(`   Dimensions: ${metadata.width}x${metadata.height}px`);
    console.log(`   Size: ${sizeKb} KB (quality: ${quality}%)`);

    if (buffer.length > MAX_COVER_BYTES) {
        console.warn(`⚠️ Warning: Image is ${sizeKb} KB, exceeding 100KB limit!`);
    }

    return {
        outputPath,
        width: metadata.width || 0,
        height: metadata.height || 0,
        sizeKb,
    };
}

/**
 * Process a transparent badge asset:
 * - Resizes to exactly 256x256
 * - Preserves transparency
 * - Encodes as WebP
 */
export async function processBadgeAsset(
    inputPath: string,
    slug: string
): Promise<ProcessResult> {
    if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file does not exist: ${inputPath}`);
    }

    fs.mkdirSync(BADGES_DIR, { recursive: true });
    const outputPath = path.join(BADGES_DIR, `${slug}.webp`);

    const buffer = await sharp(inputPath)
        .resize({
            width: TARGET_BADGE_SIZE,
            height: TARGET_BADGE_SIZE,
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .webp({ quality: 90, alphaQuality: 100, effort: 6 })
        .toBuffer();

    fs.writeFileSync(outputPath, buffer);
    const metadata = await sharp(outputPath).metadata();

    const sizeKb = Math.round((buffer.length / 1024) * 10) / 10;
    console.log(`✅ Badge asset created: ${outputPath}`);
    console.log(`   Dimensions: ${metadata.width}x${metadata.height}px`);
    console.log(`   Has alpha: ${Boolean(metadata.hasAlpha)}`);
    console.log(`   Size: ${sizeKb} KB`);

    return {
        outputPath,
        width: metadata.width || 0,
        height: metadata.height || 0,
        sizeKb,
        hasAlpha: Boolean(metadata.hasAlpha),
    };
}

async function runCli() {
    const args = process.argv.slice(2);

    if (args.includes('--test')) {
        console.log('🧪 Testing Sharp image pipeline...');
        const testSvg = Buffer.from(
            `<svg width="750" height="750" xmlns="http://www.w3.org/2000/svg">
              <rect width="750" height="750" fill="#2d3748"/>
              <circle cx="375" cy="375" r="200" fill="#48bb78"/>
            </svg>`
        );
        const testFile = path.resolve(__dirname, 'test-sample.svg');
        fs.writeFileSync(testFile, testSvg);

        await processCoverImage(testFile, 'test_sample_event');
        await processBadgeAsset(testFile, 'test_sample_badge');

        // Cleanup test outputs
        fs.unlinkSync(testFile);
        if (fs.existsSync(path.join(IMAGES_DIR, 'test_sample_event.webp'))) {
            fs.unlinkSync(path.join(IMAGES_DIR, 'test_sample_event.webp'));
        }
        if (fs.existsSync(path.join(BADGES_DIR, 'test_sample_badge.webp'))) {
            fs.unlinkSync(path.join(BADGES_DIR, 'test_sample_badge.webp'));
        }
        console.log('🎉 Sharp test completed successfully!');
        return;
    }

    if (args[0] === '--cover' || args[0] === '-c') {
        const input = args[1];
        const slug = args[2];
        if (!input || !slug) {
            console.error('Usage: npm run process:cover <input_path> <event_slug>');
            process.exit(1);
        }
        await processCoverImage(path.resolve(input), slug);
        return;
    }

    if (args[0] === '--badge' || args[0] === '-b') {
        const input = args[1];
        const slug = args[2];
        if (!input || !slug) {
            console.error('Usage: npm run process:badge <input_path> <event_slug>');
            process.exit(1);
        }
        await processBadgeAsset(path.resolve(input), slug);
        return;
    }

    console.log(`
Jorbites Asset Processing Tool 🥑

Commands:
  npm run process:cover <image_path> <event_slug>
    -> Resizes to 750x750, converts to WebP (<100KB), saves to images/<slug>.webp

  npm run process:badge <image_path> <event_slug>
    -> Resizes to 256x256, preserves transparency, saves to badges/<slug>.webp

  npm run process:test
    -> Verifies the Sharp processing pipeline
`);
}

if (require.main === module) {
    runCli().catch((err) => {
        console.error('❌ Error processing asset:', err);
        process.exit(1);
    });
}
