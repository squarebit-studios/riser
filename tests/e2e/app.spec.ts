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
  source: string;
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
      autoPlaceFromSkeleton(options?: { announce?: boolean }): number;
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

test.describe('automatic placement from a rig', () => {
  /** Load the RIGGED stock character, which carries a UsdSkel skeleton. */
  async function loadRigged(page: Page): Promise<void> {
    await page.evaluate(() => window.__riser!.loadFromUrl('/assets/biped-rigged.usda'));
    await page.waitForFunction(
      () => (window.__riser!.characterModel?.meshes.length ?? 0) > 0
    );
  }

  test('a rigged character fills its own guides on load', async ({ page }) => {
    await openApp(page);
    await loadRigged(page);

    // No clicking. The rig already contains the answer, so the app reads it.
    await page.waitForFunction(
      () => window.__riser!.store.document.guides.length > 0
    );

    const placed = await guides(page);
    expect(placed.length).toBeGreaterThanOrEqual(15);

    for (const guide of placed) {
      // Marked as the app's work, not the user's, so a later pass may improve
      // it and the UI can show it as a suggestion.
      expect(guide.source).toBe('skeleton');
      // And bound to a real triangle, or the server could not resolve it.
      expect(guide.binding, `${guide.id} is unbound`).not.toBeNull();
      expect(guide.binding!.primPath).toMatch(/^\/Riser\/Character\/Geom\//);
    }
  });

  test('an unrigged character places nothing on its own', async ({ page }) => {
    await openApp(page);
    await loadBiped(page);
    await page.waitForTimeout(600);
    expect(await guides(page)).toHaveLength(0);
  });

  test('the auto-place button is offered only when there is a rig', async ({ page }) => {
    await openApp(page);
    await loadBiped(page);
    await expect(page.getByRole('button', { name: 'Auto-place' })).toBeDisabled();

    await loadRigged(page);
    await expect(page.getByRole('button', { name: 'Auto-place' })).toBeEnabled();
  });

  test('placing by hand survives a re-run', async ({ page }) => {
    await openApp(page);
    await loadRigged(page);
    await page.waitForFunction(
      () => window.__riser!.store.document.guides.length > 0
    );

    // Adjust one guide by hand, then ask the app to auto-place again.
    await page.getByTestId('guide-chest').click();
    await clickViewport(page);
    await page.waitForFunction(
      () =>
        window.__riser!.store.document.guides.find((g) => g.id === 'chest')?.source ===
        'user'
    );
    const handPlaced = (await guides(page)).find((g) => g.id === 'chest')!;

    await page.getByRole('button', { name: 'Auto-place' }).click();
    await page.waitForTimeout(400);

    const after = (await guides(page)).find((g) => g.id === 'chest')!;
    expect(after.source).toBe('user');
    expect(after.position[0]).toBeCloseTo(handPlaced.position[0], 6);
    expect(after.position[1]).toBeCloseTo(handPlaced.position[1], 6);
  });
});

test.describe('curves are actually drawn', () => {
  /**
   * Count pixels close to a colour by reading the canvas back.
   *
   * The scene graph is not evidence. A Line2 with a stale resolution has
   * correct geometry, a correct material and a correct place in the tree, and
   * draws nothing - which is exactly the regression this guards. Only the
   * frame buffer can say whether the user can see the curve.
   */
  async function countPixelsNear(
    page: Page,
    rgb: [number, number, number],
    tolerance = 40
  ): Promise<number> {
    return page.evaluate(
      ({ rgb, tolerance }) => {
        const canvas = document.querySelector('canvas') as HTMLCanvasElement;
        const readback = document.createElement('canvas');
        readback.width = canvas.width;
        readback.height = canvas.height;
        const ctx = readback.getContext('2d')!;
        ctx.drawImage(canvas, 0, 0);
        const { data } = ctx.getImageData(0, 0, readback.width, readback.height);
        let hits = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (
            Math.abs(data[i]! - rgb[0]) < tolerance &&
            Math.abs(data[i + 1]! - rgb[1]) < tolerance &&
            Math.abs(data[i + 2]! - rgb[2]) < tolerance
          ) {
            hits++;
          }
        }
        return hits;
      },
      { rgb, tolerance }
    );
  }

  /** Show or hide only the curve LINES, leaving their control vertices alone. */
  async function setLinesVisible(page: Page, visible: boolean): Promise<number> {
    return page.evaluate((visible) => {
      const app = window.__riser as unknown as {
        viewport: { scene: { traverse(fn: (o: unknown) => void): void } };
      };
      let count = 0;
      app.viewport.scene.traverse((object) => {
        const o = object as { name?: string; material?: { visible: boolean } };
        if (o.name?.startsWith('Curve:') && o.material) {
          o.material.visible = visible;
          count++;
        }
      });
      return count;
    }, visible);
  }

  test('the line between control vertices is really rendered', async ({ page }) => {
    await openApp(page);
    await loadBiped(page);

    await page.getByRole('button', { name: 'Curves', exact: true }).click();
    await page.getByTestId('curve-spineCurve').click();

    // Place points until there are enough for a line. A click that lands on an
    // existing control vertex selects it rather than adding another, so a
    // fixed list of offsets is not reliable - keep going until the document
    // says there are three.
    const offsets = [-70, -40, -10, 20, 50, 80, -55, 5, 35, 65];
    for (const dy of offsets) {
      const points = await page.evaluate(
        () => window.__riser!.store.document.curves[0]?.points.length ?? 0
      );
      if (points >= 3) break;
      await clickViewport(page, 0, dy);
      await page.waitForTimeout(110);
    }

    const placed = await page.evaluate(
      () => window.__riser!.store.document.curves[0]?.points.length ?? 0
    );
    expect(placed, 'could not place three control vertices').toBeGreaterThanOrEqual(3);
    await page.waitForTimeout(300);

    // Control vertices and the active line share a colour, so counting that
    // colour cannot tell them apart. Hiding ONLY the line materials and
    // re-counting isolates the line exactly.
    const withLine = await countPixelsNear(page, [0xff, 0xc4, 0x47]);

    const hidden = await setLinesVisible(page, false);
    expect(hidden, 'no curve line object was found in the scene').toBeGreaterThan(0);
    await page.waitForTimeout(200);
    const withoutLine = await countPixelsNear(page, [0xff, 0xc4, 0x47]);

    await setLinesVisible(page, true);

    // Whatever the curve's length, hiding the line must remove a meaningful
    // number of pixels. If the line were never drawn, this difference is zero.
    expect(
      withLine - withoutLine,
      `hiding the line changed only ${withLine - withoutLine} pixels, so it was not drawn`
    ).toBeGreaterThan(25);
  });

  test('the line survives a window resize', async ({ page }) => {
    // The regression this exists for. Line2 computes its width in screen space
    // from a resolution its material has to be told about. That used to be set
    // only when the document changed, so a resize AFTER the last edit left it
    // stale and the line stopped being drawn - with the scene graph still
    // looking perfectly correct.
    await openApp(page);
    await loadBiped(page);

    await page.getByRole('button', { name: 'Curves', exact: true }).click();
    await page.getByTestId('curve-spineCurve').click();
    for (const dy of [-70, -40, -10, 20, 50, 80]) {
      const points = await page.evaluate(
        () => window.__riser!.store.document.curves[0]?.points.length ?? 0
      );
      if (points >= 3) break;
      await clickViewport(page, 0, dy);
      await page.waitForTimeout(110);
    }
    await page.waitForTimeout(200);

    // Resize with no further document edits, then measure.
    await page.setViewportSize({ width: 1100, height: 780 });
    await page.waitForTimeout(500);

    const withLine = await countPixelsNear(page, [0xff, 0xc4, 0x47]);
    await setLinesVisible(page, false);
    await page.waitForTimeout(200);
    const withoutLine = await countPixelsNear(page, [0xff, 0xc4, 0x47]);
    await setLinesVisible(page, true);

    expect(
      withLine - withoutLine,
      `after resizing, hiding the line changed only ${withLine - withoutLine} pixels`
    ).toBeGreaterThan(25);
  });
});
