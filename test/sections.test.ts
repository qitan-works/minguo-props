import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyRects, cutPolygon } from '../src/lib/cutline.ts';
import type { Rect } from '../src/lib/geometry.ts';
import { BODY_METRICS, EMPTY_BLOCK_EXTRAS, FLOW_KINDS, markTitle, mergeStyle, sanitizeBlockEdit, sanitizeBlockExtras, styleDiff, type BlockExtras } from '../src/lib/newspaper/blockstyle.ts';
import { layoutItem, lineCapacity, type FlowItem } from '../src/lib/newspaper/flow.ts';
import { PAGE_TYPES, defaultStyle, planPage, resolveBlocks, type PageType } from '../src/lib/newspaper/pageplan.ts';
import { sectionBounds, type SectionLayout } from '../src/lib/newspaper/sections.ts';
import { broadsheetGeometry, colLeft, rowTop, type BroadsheetGeometry, type MastheadLayout } from '../src/lib/newspaper/sheetgeom.ts';
import { blockRect, buildPage, sectionsOf, v4Cell } from '../src/render/newspaper-full.ts';
import { defaultExtras } from '../src/props/extras.ts';
import { newspaperDefaults, type NewspaperData } from '../src/props/newspaper.ts';
import { PAPER_SIZES, type PaperKey } from '../src/props/common.ts';

function page(options: { pageType?: PageType; layout?: MastheadLayout; seed?: number; paper?: PaperKey; blocks?: BlockExtras; patch?: Partial<NewspaperData> } = {}): { l: SectionLayout; g: BroadsheetGeometry; data: NewspaperData } {
  const paper = options.paper ?? 'a4-portrait';
  const size = PAPER_SIZES[paper];
  const layout = options.layout ?? 'corner-right';
  const data: NewspaperData = { ...newspaperDefaults, paper, pageType: options.pageType ?? 'news', mastheadLayout: layout === 'none' ? 'right' : layout, showMasthead: layout !== 'none', layoutSeed: options.seed ?? 1105, ...options.patch };
  const g = broadsheetGeometry({ width: size.width, height: size.height, layout, header: true, cell: v4Cell(size.width, size.height) });
  const extras = { ...defaultExtras().newspaper, blocks: options.blocks ?? EMPTY_BLOCK_EXTRAS };
  return { l: buildPage(data, extras, g).layout, g, data };
}

const LAYOUTS: MastheadLayout[] = ['right', 'corner-right', 'corner-left', 'top', 'none'];
const TYPES = PAGE_TYPES.map((p) => p.value);

describe('分段網格', () => {
  it('段數：自動依紙張（八到十二段），每段一樣高（差不超過一格）', () => {
    for (const paper of ['a4-portrait', 'a4-landscape', 'a5-portrait', 'a5-landscape'] as const) {
      const n = sectionsOf({ paper, sections: 'auto' });
      assert.ok(n >= 8 && n <= 12, `${paper} ${n}`);
    }
    for (const n of [8, 9, 10, 11, 12]) assert.equal(sectionsOf({ paper: 'a4-portrait', sections: String(n) }), n);
    const b = sectionBounds(101, 10);
    assert.equal(b.length, 11);
    assert.equal(b[10], 101);
    const heights = b.slice(1).map((v, i) => v - b[i]!);
    assert.ok(Math.max(...heights) - Math.min(...heights) <= 1);
  });

  for (const pageType of TYPES) {
    for (const layout of LAYOUTS) {
      it(`${pageType}／${layout}：每一格剛好屬於一個區塊、不重疊、排滿，區塊對齊段線`, () => {
        for (const seed of [1, 7]) {
          const { l } = page({ pageType, layout, seed });
          assert.equal(l.owner.filter((o) => o === -1).length, 0, '有空格');
          const seen = new Int32Array(l.cols * l.rows);
          for (const b of l.blocks) {
            assert.equal(b.top, l.bounds[b.s0], `${b.id} 上緣不在段線`);
            assert.equal(b.bottom, l.bounds[b.s0 + b.span], `${b.id} 下緣不在段線`);
            for (let r = b.top; r < b.bottom; r++) for (let c = b.col; c < b.col + b.w; c++) seen[r * l.cols + c]! += 1;
          }
          for (let i = 0; i < seen.length; i++) assert.equal(seen[i], l.owner[i] === -2 ? 0 : 1, `第 ${i} 格重疊或沒有區塊`);
          // 文字區塊每一行都有字
          for (const b of l.blocks) {
            if (!FLOW_KINDS.has(b.kind)) continue;
            const filled = new Set<number>();
            for (const line of b.lines) for (let k = line.slot; k < line.slot + line.span; k++) filled.add(k);
            for (let k = 0; k < b.slots.length; k++) assert.ok(filled.has(k), `${b.id} 第 ${k} 行沒有字`);
          }
          assert.equal(l.overflow, false, '預設內容不該溢出');
        }
      });
    }
  }

  it('段線位置一致：橫線都在段與段之間，每一條段線都有畫；直線的頭尾也在段線上', () => {
    for (const pageType of TYPES) {
      const { l } = page({ pageType });
      const inner = new Set(l.bounds.slice(1, -1));
      for (const r of l.rules) {
        if (r.dir === 'h') assert.ok(inner.has(r.at), `橫線 ${r.at} 不在段線上`);
        else assert.ok(l.bounds.includes(r.from) && l.bounds.includes(r.to));
      }
      // 上下兩段的區塊不同（不是同一個跨段的區塊）的地方，一定有段線
      l.bounds.slice(1, -1).forEach((at, k) => {
        for (let c = 0; c < l.cols; c++) {
          const a = l.owner[(at - 1) * l.cols + c]!;
          const b = l.owner[at * l.cols + c]!;
          if (a !== b && a !== -2 && b !== -2) assert.ok(l.rules.some((r) => r.dir === 'h' && r.at === at && c >= r.from && c < r.to), `${pageType} 第 ${k + 1} 條段線在第 ${c} 行沒畫`);
        }
      });
    }
  });

  it('頭條在右上：第一段裡最右邊的區塊，標題跨兩三段；報頭框高度對齊段線', () => {
    for (const layout of LAYOUTS) {
      for (const pageType of ['news', 'local'] as const) {
        const { l } = page({ pageType, layout });
        const lead = l.blocks.find((b) => b.plan.source === 'lead')!;
        assert.equal(lead.s0, 0, `${layout} 頭條不在第一段`);
        const others = l.blocks.filter((b) => b.s0 === 0 && b !== lead);
        assert.ok(others.every((b) => b.col > lead.col), `${layout} 頭條右邊還有別的區塊`);
        assert.ok(lead.span >= 2, '頭條跨兩三段');
        if (l.mastheadRows > 0) assert.ok(l.bounds.includes(l.mastheadRows));
      }
    }
  });

  it('同一種子同結果，換版面種子不同；四種紙張的預設內容都不溢出', () => {
    const sig = (l: SectionLayout): string => l.blocks.map((b) => `${b.id}:${b.kind}:${b.col},${b.w},${b.s0},${b.span}`).join('|');
    assert.equal(sig(page({ seed: 3 }).l), sig(page({ seed: 3 }).l));
    assert.notEqual(sig(page({ seed: 3 }).l), sig(page({ seed: 4 }).l));
    for (const paper of ['a4-portrait', 'a4-landscape', 'a5-portrait', 'a5-landscape'] as const) {
      for (const pageType of TYPES) assert.equal(page({ paper, pageType }).l.overflow, false, `${paper} ${pageType}`);
    }
  });

  it('各版面類型有自己的區塊：廣告版以廣告為主、要聞版有專電與社論、商情版有兩三張表格、副刊有連載與目錄', () => {
    const count = (l: SectionLayout, kind: string): number => l.blocks.filter((b) => b.kind === kind).length;
    const area = (l: SectionLayout, kind: string): number => l.blocks.filter((b) => b.kind === kind).reduce((n, b) => n + b.w * (b.bottom - b.top), 0);
    const ads = page({ pageType: 'ads' }).l;
    assert.ok(area(ads, 'ad') + area(ads, 'notice') > ads.cols * ads.rows * 0.45, '廣告版的廣告與啟事要佔一半以上');
    assert.ok(ads.blocks.some((b) => b.kind === 'ad' && b.style.width === 0), '要有通欄廣告');
    const news = page({ pageType: 'news' }).l;
    assert.ok(count(news, 'wire') >= 2 && count(news, 'editorial') >= 1);
    const market = page({ pageType: 'market' }).l;
    assert.ok(count(market, 'table') >= 2);
    const sup = page({ pageType: 'supplement' }).l;
    assert.ok(count(sup, 'serial') >= 1 && count(sup, 'toc') >= 1);
    assert.ok(sup.blocks.some((b) => b.style.frame === 'pattern'), '副刊有花邊框');
    // 版面最下方一排廣告
    for (const l of [news, market]) {
      const last = l.sections - 1;
      assert.ok(l.blocks.filter((b) => b.kind === 'ad' && b.s0 + b.span - 1 === last).length >= 3, '下方一排廣告');
    }
  });
});

describe('區塊個別設定', () => {
  it('刪除、新增（插在指定區塊後）、調整順序、改樣式與種類', () => {
    const plan = planPage({ pageType: 'news', seed: 5, sections: 10, cols: 60, mainHorizontal: true, hasSecond: false });
    const extras: BlockExtras = {
      edits: [
        { id: 'p3', titleStyle: 'outline', titleSize: 2, frame: 'pattern', pattern: 'cloud' },
        { id: 'p4', kind: 'table' },
      ],
      added: [{ id: 'u1', kind: 'toc', after: 'p1' }],
      removed: ['p2'],
      order: ['p5', 'p0'],
    };
    const blocks = resolveBlocks(plan, extras);
    assert.ok(!blocks.some((b) => b.id === 'p2'));
    const p3 = blocks.find((b) => b.id === 'p3')!;
    assert.equal(p3.style.titleStyle, 'outline');
    assert.equal(p3.style.titleSize, 2);
    assert.equal(p3.style.frame, 'pattern');
    const p4 = blocks.find((b) => b.id === 'p4')!;
    assert.equal(p4.style.kind, 'table');
    assert.equal(p4.source, 'table-goods');
    assert.equal(blocks.findIndex((b) => b.id === 'u1'), blocks.findIndex((b) => b.id === 'p1') + 1);
    assert.ok(blocks.findIndex((b) => b.id === 'p5') < blocks.findIndex((b) => b.id === 'p0'));
    // 只存改過的欄位
    const base = defaultStyle('news');
    assert.deepEqual(styleDiff(base, mergeStyle(base, { titleStyle: 'boxed' })), { titleStyle: 'boxed' });
  });

  it('個別設定會反映在版面上：新增的目錄、改成表格的區塊、刪掉的區塊', () => {
    const blocks: BlockExtras = { edits: [{ id: 'p1', kind: 'picture', picture: 'clock' }], added: [{ id: 'u9', kind: 'toc', after: 'p0' }], removed: ['p3'], order: [] };
    const { l } = page({ blocks });
    assert.ok(l.blocks.some((b) => b.id === 'u9' && b.kind === 'toc' && b.toc && b.toc.entries.length > 0));
    assert.ok(l.blocks.some((b) => b.id === 'p1' && b.kind === 'picture' && b.picture?.kind === 'clock'));
    assert.ok(!l.blocks.some((b) => b.id === 'p3'));
  });

  it('匯入時逐項驗證：格式不符的欄位與項目丟掉，舊存檔得到空的設定', () => {
    assert.deepEqual(sanitizeBlockExtras(undefined), { blocks: EMPTY_BLOCK_EXTRAS, dropped: 0 });
    const edit = sanitizeBlockEdit({ id: 'p1', titleSize: 9, titleStyle: 'outline', frame: 'bogus', title: '<b>x</b>'.repeat(10), span: 2, content: [{ id: 'n1', kind: 'news', title: 't', body: 'b' }, { bad: 1 }] });
    assert.ok(edit);
    assert.equal(edit.titleSize, undefined);
    assert.equal(edit.titleStyle, 'outline');
    assert.equal(edit.frame, undefined);
    assert.ok((edit.title ?? '').length <= 24);
    assert.equal(edit.content?.length, 1);
    const { blocks, dropped } = sanitizeBlockExtras({ edits: [{ id: 'bad id!' }, { id: 'p2', kind: 'ad' }], added: [{ id: 'u1', kind: 'nope', after: null }], removed: ['p3', 'p3', 5], order: 'x' });
    assert.equal(blocks.edits.length, 1);
    assert.equal(blocks.added.length, 0);
    assert.deepEqual(blocks.removed, ['p3']);
    assert.deepEqual(blocks.order, []);
    assert.ok(dropped >= 4);
  });
});

describe('標題與內文樣式', () => {
  it('括號與句首符號', () => {
    assert.equal(markTitle('遺失聲明', 'lenticular'), '【遺失聲明】');
    assert.equal(markTitle('專電', 'tortoise'), '〔專電〕');
    assert.equal(markTitle('霧中燈', 'corner'), '「霧中燈」');
    assert.equal(markTitle('要聞', 'circle'), '◎要聞');
    assert.equal(markTitle('要聞', 'triangle'), '▲要聞');
  });

  it('割注：一行裡並排兩小行，一行放得下的字是一般的兩倍以上', () => {
    const body = { size: BODY_METRICS.gz.size, split: true };
    assert.ok(lineCapacity(10, body) >= 2 * 10 * 1.8);
    const item: FlowItem = { id: 'x', source: 'filler', level: 3, title: '', subtitles: [], paragraphs: ['甲'.repeat(80)], body };
    const laid = layoutItem(item, [{ col: 0, top: 0, cap: 10 }, { col: 1, top: 0, cap: 10 }], 0, 'modern', true)!;
    assert.ok(laid.lines.every((l) => l.split === true && l.size === body.size));
    assert.ok(laid.lines[0]!.glyphs.length > 30);
    // 小字比中字放得多，大字比中字少
    assert.ok(lineCapacity(10, { size: BODY_METRICS.s.size, split: false }) > 10);
    assert.ok(lineCapacity(10, { size: BODY_METRICS.l.size, split: false }) < 10);
  });

  it('從整版剪下：剪線把頭條框內的字留下、外面的拿掉，壓在剪線上的字被切到', () => {
    const { l, g } = page({ seed: 3 });
    const items: { rect: Rect; lead: boolean }[] = [];
    for (const b of l.blocks) {
      for (const line of b.lines) {
        const slot = b.slots[line.slot + line.span - 1]!;
        items.push({ rect: { x: colLeft(g, slot.col), y: rowTop(g, line.top), w: line.span * g.pitch, h: Math.max(1, line.glyphs.length) * line.size * g.cell }, lead: b.plan.source === 'lead' });
      }
    }
    const lead = l.blocks.find((b) => b.plan.source === 'lead')!;
    const r = blockRect(g, lead);
    const frame: Rect = { x: r.x - 8, y: r.y - 2, w: r.w + 6, h: r.h + 10 };
    const result = classifyRects(items, cutPolygon(frame, 'scissors', 7));
    const kinds = new Set(result.map((x) => x.relation));
    assert.ok(kinds.has('inside') && kinds.has('outside') && kinds.has('cut'));
  });
});
