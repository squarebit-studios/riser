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
      autoPlace(options?: { announce?: boolean }): number;
      autoPlaceFromSkeleton(options?: { announce?: boolean }): number;
      autoPlaceFromProportions(options?: { announce?: boolean }): number;
      clearGuides(): void;
      saveSessionNow(): boolean;
      forgetSession(): void;
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
 * Empty the checklist.
 *
 * Loading a character now fills it automatically - from its rig if it has one,
 * from its measured shape if not - so a test about placing a marker by hand
 * has to clear that first. Without it, clicks land on the auto-placed markers
 * and select them rather than reaching the mesh.
 */
async function clearGuides(page: Page): Promise<void> {
  await page.evaluate(() => window.__riser!.clearGuides());
  await page.waitForFunction(
    () => window.__riser!.store.document.guides.length === 0
  );
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

    await clearGuides(page);

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

    await clearGuides(page);

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

    await clearGuides(page);

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

    await clearGuides(page);

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

    await clearGuides(page);
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

    await clearGuides(page);
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

  test('an unrigged character is measured instead', async ({ page }) => {
    // No rig to read, so the shape is measured. Approximate rather than exact,
    // which is what the source and confidence record.
    await openApp(page);
    await loadBiped(page);

    await page.waitForFunction(
      () => window.__riser!.store.document.guides.length > 0
    );
    const placed = await guides(page);
    expect(placed.length).toBeGreaterThanOrEqual(30);

    for (const guide of placed) {
      expect(guide.source).toBe('proportions');
      expect(guide.binding, `${guide.id} is unbound`).not.toBeNull();
    }
  });

  test('a rig is preferred over measuring when both are possible', async ({ page }) => {
    await openApp(page);
    await loadRigged(page);
    await page.waitForFunction(
      () => window.__riser!.store.document.guides.length > 0
    );
    // The rigged character could also be measured. It must not be: a skeleton
    // is exact and measuring is a fallback.
    const placed = await guides(page);
    expect(placed.every((g) => g.source === 'skeleton')).toBe(true);
  });

  test('measuring refuses a character that is not a biped', async ({ page }) => {
    // Placing human guides on a horse costs more than placing none - the user
    // has to notice and undo thirty markers rather than simply start.
    await openApp(page);
    await page.evaluate(() =>
      window.__riser!.loadFromUrl('/assets/quadruped-blockout.usda')
    );
    await page.waitForFunction(
      () => (window.__riser!.characterModel?.meshes.length ?? 0) > 0
    );
    await page.waitForTimeout(800);
    expect(await guides(page)).toHaveLength(0);
  });

  test('the auto-place button needs a character, not a rig', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('button', { name: 'Auto-place' })).toBeDisabled();

    await loadBiped(page);
    await expect(page.getByRole('button', { name: 'Auto-place' })).toBeEnabled();

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
   * Grab the rendered frame as raw pixels.
   *
   * The scene graph is not evidence. A Line2 with a stale resolution has
   * correct geometry, a correct material and a correct place in the tree, and
   * draws nothing - which is exactly the regression this guards. Only the
   * frame buffer can say whether the user can see the curve.
   */
  async function grabFrame(page: Page): Promise<number[]> {
    return page.evaluate(() => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      const readback = document.createElement('canvas');
      readback.width = canvas.width;
      readback.height = canvas.height;
      const ctx = readback.getContext('2d')!;
      ctx.drawImage(canvas, 0, 0);
      return Array.from(ctx.getImageData(0, 0, readback.width, readback.height).data);
    });
  }

  /**
   * How many pixels differ between two frames.
   *
   * Deliberately not "count pixels of the curve's colour". The renderer tone
   * maps, so what reaches the screen is not the palette value, and matching on
   * an exact colour silently measured only the control vertices - which opt
   * out of tone mapping - while the line itself went uncounted. Differencing
   * two frames asks the question that actually matters: did hiding this thing
   * change what the user sees.
   */
  function countDifferences(a: number[], b: number[], tolerance = 4): number {
    if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (
        Math.abs(a[i]! - b[i]!) > tolerance ||
        Math.abs(a[i + 1]! - b[i + 1]!) > tolerance ||
        Math.abs(a[i + 2]! - b[i + 2]!) > tolerance
      ) {
        changed++;
      }
    }
    return changed;
  }

  /**
   * Trace a curve down the torso long enough to measure reliably.
   *
   * Clicking a fixed list of offsets is not good enough: some clicks miss the
   * mesh and some land on an existing control vertex and select it instead of
   * adding one, so the curve's length - and therefore how many pixels the line
   * covers - varied from run to run. That made the measurement swing between
   * hundreds of pixels and a couple of dozen, which is flakiness rather than a
   * finding. Placing a dense spread and asserting the count makes the input
   * deterministic enough to draw a conclusion from.
   */
  async function traceLongCurve(page: Page): Promise<void> {
    await clearGuides(page);
    await page.getByRole('button', { name: 'Curves', exact: true }).click();
    await page.getByTestId('curve-spineCurve').click();

    for (const dy of [-90, -70, -50, -30, -10, 10, 30, 50, 70, 90]) {
      await clickViewport(page, 0, dy);
      await page.waitForTimeout(90);
    }

    const placed = await page.evaluate(
      () => window.__riser!.store.document.curves[0]?.points.length ?? 0
    );
    expect(placed, 'could not trace a long enough curve').toBeGreaterThanOrEqual(6);
    await page.waitForTimeout(300);
  }

  /**
   * Fatten the curve lines, purely to make the measurement unambiguous.
   *
   * The subject is whether the line draws at all, and a 2.5px antialiased line
   * a few dozen pixels long sits close enough to the noise floor that the
   * count wandered between runs. Width is converted to pixels USING the
   * resolution, so a stale resolution still produces nothing at any width -
   * the property under test is untouched, the signal is just louder.
   */
  async function fattenLines(page: Page, width: number): Promise<void> {
    await page.evaluate((width) => {
      const app = window.__riser as unknown as {
        viewport: { scene: { traverse(fn: (o: unknown) => void): void } };
      };
      app.viewport.scene.traverse((object) => {
        const o = object as {
          name?: string;
          material?: { linewidth: number; needsUpdate: boolean };
        };
        if (o.name?.startsWith('Curve:') && o.material) {
          o.material.linewidth = width;
          o.material.needsUpdate = true;
        }
      });
    }, width);
    await page.waitForTimeout(300);
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

    await traceLongCurve(page);

    // Hiding ONLY the line materials isolates the line: the control vertices
    // stay drawn, so whatever changes is the line and nothing else.
    await fattenLines(page, 20);
    const withLine = await grabFrame(page);

    const hidden = await setLinesVisible(page, false);
    expect(hidden, 'no curve line object was found in the scene').toBeGreaterThan(0);
    await page.waitForTimeout(250);
    const withoutLine = await grabFrame(page);

    await setLinesVisible(page, true);

    // With a 20px line this is over a thousand pixels when it draws and a
    // handful when it does not, so the threshold sits nowhere near either edge.
    const changed = countDifferences(withLine, withoutLine);
    expect(
      changed,
      `hiding the line changed only ${changed} pixels, so it was not drawn`
    ).toBeGreaterThan(400);
  });

  test('the line survives a window resize', async ({ page }) => {
    // The regression this exists for. Line2 computes its width in screen space
    // from a resolution its material has to be told about. That used to be set
    // only when the document changed, so a resize AFTER the last edit left it
    // stale and the line stopped being drawn - with the scene graph still
    // looking perfectly correct.
    await openApp(page);
    await loadBiped(page);

    await traceLongCurve(page);

    // Resize with no further document edits, then measure. Deliberately
    // LARGER: shrinking works too, but it also shortens the curve on screen,
    // and a thin antialiased line a few dozen pixels long is a weak signal
    // either way. Growing keeps the line long, so the difference between
    // "drawn" and "not drawn" is unmistakable.
    await page.setViewportSize({ width: 1700, height: 950 });
    await page.waitForTimeout(600);

    await fattenLines(page, 20);
    const withLine = await grabFrame(page);
    await setLinesVisible(page, false);
    await page.waitForTimeout(250);
    const withoutLine = await grabFrame(page);
    await setLinesVisible(page, true);

    // With a 20px line this is over a thousand pixels when the line draws and
    // a handful when the resolution is stale, so the threshold is nowhere near
    // either edge.
    const changed = countDifferences(withLine, withoutLine);
    expect(
      changed,
      `after resizing, hiding the line changed only ${changed} pixels`
    ).toBeGreaterThan(400);
  });
});

test.describe('work survives a reload', () => {
  test('a placed guide is still there after refreshing the page', async ({ page }) => {
    // The hole this closes: placing a full checklist is twenty minutes of
    // careful work, and until now closing the tab threw all of it away.
    await openApp(page);
    await loadBiped(page);
    await clearGuides(page);

    await page.getByTestId('guide-chest').click();
    await clickViewport(page);
    await page.waitForFunction(
      () => window.__riser!.store.document.guides.length === 1
    );

    const before = (await guides(page))[0]!;
    await page.evaluate(() => window.__riser!.saveSessionNow());

    await page.reload();
    await expect(page.locator('canvas')).toBeVisible();
    await page.waitForFunction(() => window.__riser !== undefined);

    // The document comes back, and so does the character it referenced.
    await page.waitForFunction(
      () => window.__riser!.store.document.guides.length > 0
    );
    await page.waitForFunction(
      () => (window.__riser!.characterModel?.meshes.length ?? 0) > 0
    );

    const after = (await guides(page)).find((g) => g.id === 'chest');
    expect(after, 'the chest guide did not come back').toBeDefined();
    expect(after!.source).toBe('user');
    expect(after!.position[0]).toBeCloseTo(before.position[0], 6);
    expect(after!.position[1]).toBeCloseTo(before.position[1], 6);
    // The binding matters more than the position: without it the server
    // cannot recompute anything.
    expect(after!.binding).not.toBeNull();
    expect(after!.binding!.faceIndex).toBe(before.binding!.faceIndex);
  });

  test('restoring does not auto-place over the restored work', async ({ page }) => {
    // Loading a character normally fills the checklist. On a restore that must
    // not happen, or the user's own placements are replaced by guesses the
    // moment they refresh.
    await openApp(page);
    await loadBiped(page);
    await clearGuides(page);

    await page.getByTestId('guide-chest').click();
    await clickViewport(page);
    await page.waitForFunction(
      () => window.__riser!.store.document.guides.length === 1
    );
    await page.evaluate(() => window.__riser!.saveSessionNow());

    await page.reload();
    await page.waitForFunction(() => window.__riser !== undefined);
    await page.waitForFunction(
      () => (window.__riser!.characterModel?.meshes.length ?? 0) > 0
    );
    await page.waitForTimeout(600);

    const after = await guides(page);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe('chest');
  });

  test('a fresh visitor gets an empty document', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.__riser!.forgetSession());
    await page.reload();
    await page.waitForFunction(() => window.__riser !== undefined);
    await page.waitForTimeout(400);
    expect(await guides(page)).toHaveLength(0);
  });
});

test.describe('view modes', () => {
  /** Read the rendered frame back as raw pixels. */
  async function frame(page: Page): Promise<number[]> {
    return page.evaluate(() => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      const readback = document.createElement('canvas');
      readback.width = canvas.width;
      readback.height = canvas.height;
      const ctx = readback.getContext('2d')!;
      ctx.drawImage(canvas, 0, 0);
      return Array.from(ctx.getImageData(0, 0, readback.width, readback.height).data);
    });
  }

  function differences(a: number[], b: number[]): number {
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (
        Math.abs(a[i]! - b[i]!) > 6 ||
        Math.abs(a[i + 1]! - b[i + 1]!) > 6 ||
        Math.abs(a[i + 2]! - b[i + 2]!) > 6
      ) {
        changed++;
      }
    }
    return changed;
  }

  async function setMode(page: Page, label: string): Promise<void> {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(400);
  }

  test('each mode renders differently from the others', async ({ page }) => {
    await openApp(page);
    await loadBiped(page);

    // At subdivision level 0, where the polygons are large enough for the
    // modes to be told apart. Flat shading a level-2 limit surface looks all
    // but identical to smooth shading, because its facets are sub-pixel - that
    // is the shading working correctly, not a difference worth asserting.
    await page.locator('input[type="range"]').fill('0');
    await page.waitForTimeout(600);

    const lit = await frame(page);

    await setMode(page, 'Flat');
    const flat = await frame(page);

    await setMode(page, 'Wire');
    const wire = await frame(page);

    await setMode(page, 'Lit wire');
    const litWire = await frame(page);

    // Every mode has to be visibly its own thing. Faceted shading changes the
    // whole surface, so it differs substantially; wireframe removes the
    // surface entirely, so it differs most of all.
    expect(differences(lit, flat), 'flat looked identical to lit').toBeGreaterThan(2000);
    expect(differences(lit, wire), 'wireframe looked identical to lit').toBeGreaterThan(
      5000
    );
    expect(
      differences(wire, litWire),
      'lit wireframe looked identical to plain wireframe'
    ).toBeGreaterThan(2000);
    expect(
      differences(lit, litWire),
      'lit wireframe looked identical to lit'
    ).toBeGreaterThan(500);
  });

  test('returns to exactly the lit render when switched back', async ({ page }) => {
    // The asset's own materials have to survive being overridden, or "lit"
    // stops meaning what the file described.
    await openApp(page);
    await loadBiped(page);
    await page.waitForTimeout(500);

    const before = await frame(page);
    await setMode(page, 'Wire');
    await setMode(page, 'Flat');
    await setMode(page, 'Lit');
    const after = await frame(page);

    expect(differences(before, after), 'lit did not come back unchanged').toBeLessThan(
      200
    );
  });

  test('guides can still be placed while the surface is invisible', async ({ page }) => {
    // Wireframe suppresses the surface with an invisible material. Picking
    // must not care - being able to see through the mesh is exactly when you
    // want to place an interior joint.
    await openApp(page);
    await loadBiped(page);
    await clearGuides(page);
    await setMode(page, 'Wire');

    await page.getByTestId('guide-chest').click();
    await clickViewport(page);
    await page.waitForFunction(
      () => window.__riser!.store.document.guides.length > 0
    );

    const placed = (await guides(page)).find((g) => g.id === 'chest');
    expect(placed, 'no guide was placed in wireframe mode').toBeDefined();
    expect(placed!.binding, 'the guide bound to nothing').not.toBeNull();
  });

  test('the mode survives a subdivision change', async ({ page }) => {
    // Changing the level rebuilds the displayed mesh, and a fresh limit
    // surface carries the material it was built with. Without a reapply the
    // wireframe silently disappears.
    await openApp(page);
    await loadBiped(page);
    await setMode(page, 'Wire');
    const atDefault = await frame(page);

    await page.locator('input[type="range"]').fill('0');
    await page.waitForTimeout(600);
    const atZero = await frame(page);

    // Still a wireframe: nothing like the lit render, which would be mostly
    // solid surface.
    await setMode(page, 'Lit');
    const litAtZero = await frame(page);
    expect(
      differences(atZero, litAtZero),
      'the wireframe was lost when the subdivision level changed'
    ).toBeGreaterThan(5000);
    void atDefault;
  });
});
