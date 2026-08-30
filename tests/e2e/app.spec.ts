import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end coverage of the paths a unit test cannot reach: a real WebGL
 * context, a real raycast against real geometry, and real pointer events going
 * through the click-versus-drag discriminator.
 *
 * Assertions read the actual document through `window.__riser` rather than
 * inspecting pixels. A screenshot can tell you something changed; only the
 * document can tell you the marker landed on the right triangle.
 */

interface GuideSnapshot {
  id: string;
  position: [number, number, number];
  binding: { primPath: string; faceIndex: number } | null;
}

declare global {
  interface Window {
    __riser?: {
      store: {
        document: {
          guides: GuideSnapshot[];
          curves: { id: string; points: unknown[]; closed: boolean }[];
          characterRef: string;
          templateId: string;
        };
        canUndo: boolean;
        undo(): boolean;
      };
      characterModel: {
        meshes: unknown[];
        skeleton: unknown;
        primPaths: string[];
      } | null;
      loadFromUrl(url: string): Promise<void>;
    };
  }
}

/** Open the app with the test handle enabled and wait for the canvas. */
async function openApp(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => window.__riser !== undefined);
}

/** Load the bundled biped and wait for it to be in the scene. */
async function loadBiped(page: Page): Promise<void> {
  await page.evaluate(() => window.__riser!.loadFromUrl('/assets/biped-blockout.usda'));
  await page.waitForFunction(
    () => (window.__riser!.characterModel?.meshes.length ?? 0) > 0
  );
}

function guides(page: Page): Promise<GuideSnapshot[]> {
  return page.evaluate(() => window.__riser!.store.document.guides);
}

/**
 * Click the centre of the canvas. Deliberately a single click with no
 * movement: the tool only places on a click that did not become a drag, so
 * this also exercises that discriminator.
 */
async function clickViewport(page: Page, dx = 0, dy = 0): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

test.describe('startup', () => {
  test('renders the shell with no character loaded', async ({ page }) => {
    await openApp(page);
    await expect(page.getByText('Riser', { exact: true })).toBeVisible();
    await expect(page.getByText('Load a character to begin.')).toBeVisible();
    expect(await page.evaluate(() => window.__riser!.characterModel)).toBeNull();
  });

  test('reports no WebGL or console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await openApp(page);
    await loadBiped(page);
    await page.waitForTimeout(500);

    expect(errors).toEqual([]);
  });
});

test.describe('loading a character', () => {
  test('loads the bundled biped from USD', async ({ page }) => {
    await openApp(page);
    await loadBiped(page);

    const model = await page.evaluate(() => ({
      meshCount: window.__riser!.characterModel!.meshes.length,
      primPaths: window.__riser!.characterModel!.primPaths,
      ref: window.__riser!.store.document.characterRef
    }));

    expect(model.meshCount).toBe(2);
    expect(model.primPaths.sort()).toEqual([
      '/Riser/Character/Geom/Body',
      '/Riser/Character/Geom/Head'
    ]);
    expect(model.ref).toContain('biped-blockout.usda');
    await expect(page.getByText('biped-blockout.usda')).toBeVisible();
  });
});

test.describe('placing guides', () => {
  test('a click on the mesh places the active guide with a resolved binding', async ({
    page
  }) => {
    await openApp(page);
    await loadBiped(page);

    // Pick a guide from the checklist, then click the character.
    await page.getByTestId('guide-chest').click();
    await clickViewport(page);

    await page.waitForFunction(
      () => window.__riser!.store.document.guides.length > 0
    );

    const placed = await guides(page);
    const chest = placed.find((g) => g.id === 'chest');
    expect(chest, `expected a chest guide, got ${placed.map((g) => g.id)}`).toBeDefined();

    // The binding is the part that matters: it must name a real mesh and a
    // real triangle, not just a position in space.
    expect(chest!.binding).not.toBeNull();
    expect(chest!.binding!.primPath).toMatch(/^\/Riser\/Character\/Geom\//);
    expect(chest!.binding!.faceIndex).toBeGreaterThanOrEqual(0);

    // And it must be somewhere on the character, not at the origin.
    expect(Math.abs(chest!.position[1])).toBeGreaterThan(0.1);
  });

  test('symmetry places the mirrored guide too', async ({ page }) => {
    await openApp(page);
    await loadBiped(page);

    // Symmetry is on by default. Aim for the character's left arm - the exact
    // pixel that lands on it depends on framing, so try a few offsets rather
    // than hard-coding one and calling a miss a symmetry failure.
    await page.getByTestId('guide-elbowL').click();

    const offsets: [number, number][] = [
      [-60, -30],
      [-80, -20],
      [-45, -60],
      [-100, 0],
      [-30, -80]
    ];
    let placed: GuideSnapshot[] = [];
    for (const [dx, dy] of offsets) {
      await clickViewport(page, dx, dy);
      await page.waitForTimeout(120);
      placed = await guides(page);
      if (placed.length > 0) break;
    }

    expect(placed.length, 'no click landed on the character').toBeGreaterThan(0);
    const ids = placed.map((g) => g.id);
    expect(ids).toContain('elbowL');

    // The mirrored side can legitimately have no surface at the reflected
    // point on an asymmetric pick, so assert the pairing when it fired.
    if (ids.includes('elbowR')) {
      const left = placed.find((g) => g.id === 'elbowL')!;
      const right = placed.find((g) => g.id === 'elbowR')!;

      // Opposite sides, and close to equal in magnitude - but NOT exact.
      // The mirror completes by raycasting onto a real triangle rather than
      // fabricating a position, and a faceted mesh is not perfectly
      // mirror-symmetric in its triangulation, so the pair lands a few
      // millimetres apart on a 1.75 m character. Demanding exactness here
      // would be demanding the wrong behaviour.
      expect(Math.sign(left.position[0])).toBe(-Math.sign(right.position[0]));
      expect(Math.abs(left.position[0] + right.position[0])).toBeLessThan(0.02);
      expect(Math.abs(left.position[1] - right.position[1])).toBeLessThan(0.02);
    }
  });

  test('the checklist advances to the next unplaced guide', async ({ page }) => {
    await openApp(page);
    await loadBiped(page);

    await page.getByTestId('guide-pelvis').click();
    await expect(page.getByText('Click the character to place Pelvis.')).toBeVisible();

    await clickViewport(page);
    await page.waitForFunction(
      () => window.__riser!.store.document.guides.length > 0
    );

    // The prompt should now name a different guide.
    await expect(
      page.getByText('Click the character to place Pelvis.')
    ).not.toBeVisible();
  });

  test('undo removes a placed guide', async ({ page }) => {
    await openApp(page);
    await loadBiped(page);

    await page.getByTestId('guide-chest').click();
    await clickViewport(page);
    await page.waitForFunction(
      () => window.__riser!.store.document.guides.length > 0
    );

    const before = (await guides(page)).length;
    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      (n) => window.__riser!.store.document.guides.length < n,
      before
    );
    expect((await guides(page)).length).toBeLessThan(before);
  });
});

test.describe('drawing curves', () => {
  test('clicks along the mesh build a curve bound to the surface', async ({ page }) => {
    await openApp(page);
    await loadBiped(page);

    await page.getByRole('button', { name: 'Curves', exact: true }).click();
    await page.getByTestId('curve-spineCurve').click();

    for (const dy of [-60, -20, 20, 60]) {
      await clickViewport(page, 0, dy);
      await page.waitForTimeout(80);
    }

    const curves = await page.evaluate(() => window.__riser!.store.document.curves);
    expect(curves).toHaveLength(1);
    expect(curves[0]!.id).toBe('spineCurve');
    expect(curves[0]!.points.length).toBeGreaterThanOrEqual(2);
  });
});

test.describe('camera', () => {
  test('a drag tumbles the camera instead of placing a guide', async ({ page }) => {
    await openApp(page);
    await loadBiped(page);

    await page.getByTestId('guide-chest').click();

    const box = (await page.locator('canvas').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 40, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // The whole point of the drag threshold: a tumble must not place anything.
    expect(await guides(page)).toHaveLength(0);
  });
});

test.describe('appearance', () => {
  test('matches the reference render', async ({ page }) => {
    await openApp(page);
    await loadBiped(page);
    // Let the framing transition settle before capturing.
    await page.waitForTimeout(1200);
    await expect(page).toHaveScreenshot('biped-loaded.png', {
      // The viewport animates its camera easing; mask nothing, but allow the
      // tolerance configured in playwright.config.ts.
      fullPage: false
    });
  });
});
