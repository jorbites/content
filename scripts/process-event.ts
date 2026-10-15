import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const EVENTS_IMAGES_DIR = path.resolve(__dirname, '../images/events');
const BADGES_DIR = path.resolve(__dirname, '../badges');
const MAX_COVER_BYTES = 100 * 1024; // 100 KB
const TARGET_COVER_SIZE = 750;
const TARGET_BADGE_SIZE = 256;

export interface ProcessResult {
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
export async function processEventCover(
    inputPath: string,
    slug: string
): Promise<ProcessResult> {
    if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file does not exist: ${inputPath}`);
    }

    fs.mkdirSync(EVENTS_IMAGES_DIR, { recursive: true });
    const outputPath = path.join(EVENTS_IMAGES_DIR, `${slug}.webp`);

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
    console.log(`✅ Event cover image created: ${outputPath}`);
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
export async function processEventBadge(
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
    console.log(`✅ Event badge asset created: ${outputPath}`);
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

/**
 * Automatically generate a transparent 256x256 badge from a cover image using rembg:
 * 1. Executes rembg to isolate foreground subject and create transparent alpha mask
 * 2. Uses Sharp to resize to exactly 256x256 WebP
 * 3. Saves to badges/<slug>.webp
 */
export async function generateBadgeFromCover(
    coverPath: string,
    slug: string
): Promise<ProcessResult> {
    if (!fs.existsSync(coverPath)) {
        throw new Error(`Cover image does not exist: ${coverPath}`);
    }

    fs.mkdirSync(BADGES_DIR, { recursive: true });
    const outputPath = path.join(BADGES_DIR, `${slug}.webp`);
    const tempNoBgPath = path.join(BADGES_DIR, `temp-${slug}-nobg.png`);

    console.log(`🤖 [generateBadge] Isolating subject from cover with rembg: ${coverPath}...`);

    try {
        const { execSync } = require('child_process');
        execSync(`rembg i "${coverPath}" "${tempNoBgPath}"`, { stdio: 'inherit' });
    } catch (err: any) {
        throw new Error(
            `rembg execution failed. Ensure rembg is installed via 'pip install rembg[cli] onnxruntime': ${err.message}`
        );
    }

    if (!fs.existsSync(tempNoBgPath)) {
        throw new Error(`rembg did not generate expected output at ${tempNoBgPath}`);
    }

    // Resize isolated cutout to 256x256 WebP with clean transparent background
    const buffer = await sharp(tempNoBgPath)
        .resize({
            width: TARGET_BADGE_SIZE,
            height: TARGET_BADGE_SIZE,
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .webp({ quality: 90, alphaQuality: 100, effort: 6 })
        .toBuffer();

    fs.writeFileSync(outputPath, buffer);

    if (fs.existsSync(tempNoBgPath)) {
        fs.unlinkSync(tempNoBgPath);
    }

    const metadata = await sharp(outputPath).metadata();
    const sizeKb = Math.round((buffer.length / 1024) * 10) / 10;
    console.log(`✅ Badge auto-generated: ${outputPath}`);
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
        console.log('🧪 Testing Sharp event pipeline...');
        const testSvg = Buffer.from(
            `<svg width="750" height="750" xmlns="http://www.w3.org/2000/svg">
              <rect width="750" height="750" fill="#2d3748"/>
              <circle cx="375" cy="375" r="200" fill="#48bb78"/>
            </svg>`
        );
        const testFile = path.resolve(__dirname, 'test-sample.svg');
        fs.writeFileSync(testFile, testSvg);

        await processEventCover(testFile, 'test_sample_event');
        await processEventBadge(testFile, 'test_sample_badge');

        fs.unlinkSync(testFile);
        if (fs.existsSync(path.join(EVENTS_IMAGES_DIR, 'test_sample_event.webp'))) {
            fs.unlinkSync(path.join(EVENTS_IMAGES_DIR, 'test_sample_event.webp'));
        }
        if (fs.existsSync(path.join(BADGES_DIR, 'test_sample_badge.webp'))) {
            fs.unlinkSync(path.join(BADGES_DIR, 'test_sample_badge.webp'));
        }
        console.log('🎉 Sharp event test completed successfully!');
        return;
    }

    const command = args[0];
    const inputPath = args[1];
    const slug = args[2];

    if (!command || !inputPath || !slug) {
        console.log('Usage:');
        console.log('  npx tsx scripts/process-event.ts --cover <input_path> <slug>');
        console.log('  npx tsx scripts/process-event.ts --badge <input_path> <slug>');
        console.log('  npx tsx scripts/process-event.ts --generate-badge <cover_path> <slug>');
        console.log('  npx tsx scripts/process-event.ts --test');
        process.exit(1);
    }

    try {
        if (command === '--cover') {
            await processEventCover(inputPath, slug);
        } else if (command === '--badge') {
            await processEventBadge(inputPath, slug);
        } else if (command === '--generate-badge') {
            await generateBadgeFromCover(inputPath, slug);
        } else {
            console.error(`Unknown command: ${command}`);
            process.exit(1);
        }
    } catch (err: any) {
        console.error('Error processing event asset:', err.message);
        process.exit(1);
    }
}

if (require.main === module) {
    runCli();
}
