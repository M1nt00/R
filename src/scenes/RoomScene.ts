import Phaser from 'phaser';
import { VIEW_W, VIEW_H, RENDER_SCALE, TILE, COLS, ROWS, DEPTH, FONT_S, WORLD_W, WORLD_H } from '../config';
import { Terrain } from '../element/terrain';
import { ReactionEngine } from '../element/reactionEngine';
import { DATA, colorOf } from '../element/data';
import { ELEMENTS, type Element, type Team } from '../element/types';
import { Combat } from '../combat/damage';
import { Vfx } from '../combat/vfx';
import { Lighting } from '../combat/lighting';
import { Hitstop, Scheduler } from '../combat/hitstop';
import { FieldSystem } from '../combat/fields';
import { ProjectileSystem } from '../combat/projectiles';
import { Player, type PlayerStats } from '../entities/player';
import { Enemy, ENEMY_DEFS, type EnemyKind, type EnemyOpts } from '../entities/enemy';
import { Golem } from '../entities/boss';
import { Door, Pickup, Interactable, Dummy, REWARD_COLOR } from '../entities/props';
import type { Actor } from '../entities/actor';
import {
  BOSS_TEMPLATE,
  COMBAT_TEMPLATES,
  DOOR_SLOTS,
  ENTRANCE_COL,
  HEAL_TEMPLATE,
  HUB_TEMPLATE,
  SHOP_TEMPLATE,
  findMarkers,
  wrapTemplate,
  type RoomKind,
  type RoomTemplate,
} from '../run/rooms';
import {
  BOONS,
  RELICS,
  REGION,
  MAX_RELICS,
  doorOptions,
  endRun,
  enterRoom,
  getRun,
  rollBoons,
  rollRelics,
  startRun,
  type BoonDef,
  type RelicDef,
  type RoomSpec,
  type RunState,
} from '../run/runState';
import { computeMods } from '../run/mods';
import { meta, playerBase, saveMeta } from '../run/meta';
import { C, ELEMENT_COLOR, ELEMENT_LIGHT, toCss } from '../art/palette';
import { ICON } from '../art/propSprites';
import { playSfx, playMusic } from '../audio/sfx';

const CHANNEL_PUSH = 70;
const DEV = new URLSearchParams(location.search).has('dev');
/** 프레임당 최대 시간 (테스트 환경처럼 프레임이 낮을 때만 ?maxdt= 로 조정) */
const MAX_DT = Number(new URLSearchParams(location.search).get('maxdt') ?? 1 / 20);

export type RoomState = 'intro' | 'play' | 'cleared' | 'dead' | 'victory' | 'leaving';

interface WavePlan {
  kinds: EnemyKind[];
  elites: number;
}

export interface ShopItem {
  type: 'relic' | 'boon' | 'potion' | 'heal';
  price: number;
  relic?: RelicDef;
  sold: boolean;
  name: string;
  desc: string;
}

export type UiRequest =
  | { type: 'boons'; options: BoonDef[]; source: 'reward' | 'shop' }
  | { type: 'relics'; options: RelicDef[] }
  | { type: 'altar' }
  | { type: 'result'; victory: boolean };

export class RoomScene extends Phaser.Scene {
  player!: Player;
  enemies: Enemy[] = [];
  boss: Golem | null = null;
  dummies: Dummy[] = [];
  terrain!: Terrain;
  engine!: ReactionEngine;
  combat!: Combat;
  vfx!: Vfx;
  lighting!: Lighting;
  fields!: FieldSystem;
  projectiles!: ProjectileSystem;
  scheduler!: Scheduler;
  hitstop!: Hitstop;
  run: RunState | null = null;
  mode: RoomKind = 'hub';
  roomName = '';
  state: RoomState = 'play';
  gameTime = 0;
  combatEnabled = true;
  trial = false;
  doors: Door[] = [];
  pickups: Pickup[] = [];
  interactables: Interactable[] = [];
  shopItems: ShopItem[] = [];
  waveIdx = 0;
  waveCount = 0;

  private flames: { img: Phaser.GameObjects.Image; x: number; y: number; ph: number }[] = [];
  private glows: { x: number; y: number; r: number; color: number; a: number }[] = [];
  private waves: WavePlan[] = [];
  private pending = 0;
  private waveDelay = 0;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private playerGroup!: Phaser.Physics.Arcade.Group;
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private keyE!: Phaser.Input.Keyboard.Key;
  private prompt!: Phaser.GameObjects.Text;
  private promptTarget: Interactable | Pickup | null = null;
  private emberT = 0;
  private portalImgs: Phaser.GameObjects.Image[] = [];
  layout: string[] = [];
  private lookX = 0;
  private lookY = 0;

  constructor() {
    super('Room');
  }

  create(data: { hub?: boolean } = {}): void {
    this.gameTime = 0;
    this.enemies = [];
    this.boss = null;
    this.dummies = [];
    this.doors = [];
    this.pickups = [];
    this.interactables = [];
    this.shopItems = [];
    this.flames = [];
    this.glows = [];
    this.waves = [];
    this.waveIdx = 0;
    this.waveCount = 0;
    this.pending = 0;
    this.portalImgs = [];
    this.trial = false;

    this.run = data.hub ? null : getRun();
    this.mode = this.run ? this.run.room.kind : 'hub';
    const tpl = this.templateFor();
    this.roomName = this.run ? `${REGION.name} ${this.run.depth}/${REGION.length} · ${tpl.name}` : tpl.name;
    this.layout = wrapTemplate(tpl, { braziers: true });
    if (this.mode === 'boss' || this.mode === 'hub') this.layout[1] = this.layout[1].replace(/./g, (_ch, i) => (i === 9 || i === 26 ? 'b' : '#'));

    const cam = this.cameras.main;
    cam.setZoom(1).setBounds(0, 0, WORLD_W, WORLD_H).setRoundPixels(true);
    cam.fadeIn(350, 24, 20, 37);
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.input.mouse?.disableContextMenu();
    this.keyE = this.input.keyboard!.addKey('E');

    this.scheduler = new Scheduler();
    this.hitstop = new Hitstop();
    this.vfx = new Vfx(this);
    const theme = this.mode === 'hub' ? 'shrine' : this.mode === 'boss' ? 'boss' : 'ash';
    this.lighting = new Lighting(this, theme === 'shrine' ? 0x5a6988 : theme === 'boss' ? 0x733e39 : 0x5a6988);
    this.vfx.lighting = this.lighting;
    this.terrain = new Terrain(this, this.layout, theme);
    this.combat = new Combat(this);
    this.engine = new ReactionEngine(this);
    this.engine.mods = computeMods(this.run);
    this.engine.secondaryUnlocked = new Set(meta.secondary);
    this.fields = new FieldSystem(this);
    this.projectiles = new ProjectileSystem(this);
    this.add.image(0, 0, 'vignette').setOrigin(0).setDepth(DEPTH.vignette).setScrollFactor(0);

    this.walls = this.physics.add.staticGroup();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.terrain.base[this.terrain.idx(c, r)] !== 'wall') continue;
        const w = this.walls.create(c * TILE + TILE / 2, r * TILE + TILE / 2, 'px') as Phaser.Physics.Arcade.Sprite;
        w.setVisible(false).setDisplaySize(TILE, TILE).refreshBody();
      }
    }
    this.playerGroup = this.physics.add.group();
    this.enemyGroup = this.physics.add.group();
    this.physics.add.collider(this.playerGroup, this.walls);
    this.physics.add.collider(this.enemyGroup, this.walls);
    this.physics.add.collider(this.enemyGroup, this.enemyGroup);

    this.buildDecor();
    this.spawnPlayer();
    // 카메라: 부드럽게 따라가되 마우스 방향으로 살짝 앞서감
    cam.startFollow(this.player.phys, true, 0.12, 0.12);
    cam.centerOn(this.player.x, this.player.y);
    this.lookX = 0;
    this.lookY = 0;
    this.prompt = this.add
      .text(0, 0, '', { fontFamily: FONT_S, fontSize: '8px', color: '#fee761' })
      .setOrigin(0.5, 1)
      .setResolution(RENDER_SCALE)
      .setShadow(1, 1, '#181425', 0, false, true)
      .setDepth(DEPTH.text);

    this.state = 'play';
    this.setupMode();
    this.input.keyboard!.on('keydown-T', this.onToggleTrial, this);
    if (DEV) this.input.keyboard!.on('keydown', this.onDevKey, this);
    this.events.once('shutdown', () => {
      this.input.keyboard!.off('keydown-T', this.onToggleTrial, this);
      this.input.keyboard!.off('keydown', this.onDevKey, this);
    });
    this.game.events.emit('roomEnter', this);
  }

  private templateFor(): RoomTemplate {
    if (!this.run) return HUB_TEMPLATE;
    const id = this.run.room.template;
    if (this.mode === 'shop') return SHOP_TEMPLATE;
    if (this.mode === 'heal') return HEAL_TEMPLATE;
    if (this.mode === 'boss') return BOSS_TEMPLATE;
    return COMBAT_TEMPLATES.find((t) => t.id === id) ?? COMBAT_TEMPLATES[0];
  }

  private tileCenter(c: number, r: number) {
    return { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
  }

  private buildDecor(): void {
    // 화로 (빛 + 일렁이는 불꽃)
    for (const { c, r } of findMarkers(this.layout, 'b')) {
      const { x, y } = this.tileCenter(c, r);
      this.add.image(x, y + 2, 'brazier', '0').setDepth(DEPTH.terrain + 0.3);
      const img = this.add.image(x, y - 3, 'flame', '0').setDepth(DEPTH.terrain + 0.4).setOrigin(0.5, 1);
      this.flames.push({ img, x, y: y - 4, ph: Math.random() * 10 });
    }
    // 입구 철창
    if (this.mode !== 'hub') {
      this.add.image(ENTRANCE_COL * TILE + TILE, (ROWS - 1) * TILE, 'gate', '0').setOrigin(0.5, 0).setDepth(DEPTH.terrain + 0.5);
    }
    // 문 (위쪽 벽)
    if (this.mode !== 'hub' && this.mode !== 'boss') for (const col of DOOR_SLOTS) this.doors.push(new Door(this, col));
  }

  private spawnPlayer(): void {
    const base = playerBase();
    const run = this.run;
    const st: PlayerStats = run
      ? { maxHp: run.maxHp, hp: run.hp, atk: base.atk, speed: base.speed, rollMax: base.rollMax, attach: base.attach, potions: run.potions }
      : { maxHp: base.maxHp, hp: base.maxHp, atk: base.atk, speed: base.speed, rollMax: base.rollMax, attach: base.attach, potions: base.potions };
    const el = (this.registry.get('element') as Element | undefined) ?? 'fire';
    const pos = this.mode === 'hub' ? { x: WORLD_W / 2, y: 15 * TILE + 8 } : { x: ENTRANCE_COL * TILE + TILE, y: (ROWS - 2) * TILE + 6 };
    this.player = new Player(this, this.playerGroup, pos.x, pos.y, st, el);
  }

  // ───────────────────────── 방 종류별 준비 ─────────────────────────

  private setupMode(): void {
    const run = this.run;
    switch (this.mode) {
      case 'hub':
        playMusic('hub');
        this.setupHub();
        break;
      case 'combat':
      case 'elite':
        playMusic('run');
        this.buildWaves(run!.room);
        this.scheduler.after(0.9, () => this.spawnWave());
        this.banner(this.mode === 'elite' ? '엘리트 방' : this.roomName.split(' · ')[1], this.mode === 'elite' ? 0xfee761 : 0xffffff);
        break;
      case 'shop':
        playMusic('hub');
        this.setupShop();
        this.banner('떠돌이 상인', C.gold0);
        this.scheduler.after(0.6, () => this.openDoors());
        this.state = 'cleared';
        break;
      case 'heal':
        playMusic('hub');
        this.setupFountain();
        this.banner('고요한 샘', 0xf6757a);
        this.scheduler.after(0.6, () => this.openDoors());
        this.state = 'cleared';
        break;
      case 'boss': {
        playMusic('boss');
        const m = findMarkers(this.layout, 'X')[0] ?? { c: 14, r: 6 };
        const { x, y } = this.tileCenter(m.c, m.r);
        this.vfx.telegraph(x, y, 40, C.fire1, 1.4);
        this.banner('잿불의 심장', C.fire1);
        this.scheduler.after(1.4, () => {
          this.boss = new Golem(this, this.enemyGroup, x, y, 1 + 0.05 * (meta.wins ?? 0));
          this.vfx.explosion(x, y, 50, C.fire1);
          this.shake(0.5, 0.01);
          this.banner('잿불 골렘', C.fire1);
        });
        break;
      }
    }
  }

  private setupHub(): void {
    const P = findMarkers(this.layout, 'P')[0];
    if (P) {
      const { x, y } = this.tileCenter(P.c, P.r);
      const b = this.add.image(x, y + 14, 'portal', '0').setOrigin(0.5, 1).setDepth(DEPTH.actor + y);
      const e = this.add.image(x, y + 14, 'portal_elem', '0').setOrigin(0.5, 1).setDepth(DEPTH.actor + y + 0.1);
      this.portalImgs = [b, e];
      const it = new Interactable(x, y + 12, 22, 'E 출발 — 잿빛 회랑', () => this.beginRun());
      this.interactables.push(it);
    }
    const A = findMarkers(this.layout, 'A')[0];
    if (A) {
      const { x, y } = this.tileCenter(A.c, A.r);
      this.add.image(x, y + 8, 'altar', '0').setOrigin(0.5, 1).setDepth(DEPTH.actor + y);
      this.add.image(x, y + 8, 'altar_elem_arcane', '0').setOrigin(0.5, 1).setDepth(DEPTH.actor + y + 0.1);
      this.glows.push({ x, y: y - 8, r: 70, color: 0xc0cbdc, a: 0.8 });
      this.interactables.push(new Interactable(x, y + 8, 22, 'E 원소의 제단 — 성장', () => this.requestUi({ type: 'altar' })));
      const altarBlock = this.walls.create(x, y + 4, 'px') as Phaser.Physics.Arcade.Sprite;
      altarBlock.setVisible(false).setDisplaySize(24, 8).refreshBody();
    }
    ['1', '2', '3', '4'].forEach((ch, i) => {
      const m = findMarkers(this.layout, ch)[0];
      if (!m) return;
      const { x, y } = this.tileCenter(m.c, m.r);
      const el = ELEMENTS[i];
      this.add.image(x, y + 8, 'pillar_el', '0').setOrigin(0.5, 1).setDepth(DEPTH.actor + y);
      this.add.image(x, y + 8, `pillar_el_elem_${el}`, '0').setOrigin(0.5, 1).setDepth(DEPTH.actor + y + 0.1);
      this.glows.push({ x, y: y - 16, r: 60, color: ELEMENT_COLOR[el], a: 0.8 });
      const blk = this.walls.create(x, y + 4, 'px') as Phaser.Physics.Arcade.Sprite;
      blk.setVisible(false).setDisplaySize(10, 8).refreshBody();
    });
    for (const m of findMarkers(this.layout, 'T')) {
      const { x, y } = this.tileCenter(m.c, m.r);
      this.dummies.push(new Dummy(this, this.enemyGroup, x, y));
    }
  }

  private setupShop(): void {
    const run = this.run!;
    const relic = rollRelics(run, 1)[0];
    const items: ShopItem[] = [];
    if (relic && run.relics.length < MAX_RELICS) {
      items.push({ type: 'relic', price: 130 + run.depth * 6, relic, sold: false, name: relic.name, desc: relic.desc });
    }
    items.push({ type: 'boon', price: 85 + run.depth * 4, sold: false, name: '반응 강화', desc: '반응 강화 3지선다' });
    items.push(
      Math.random() < 0.5
        ? { type: 'potion', price: 45, sold: false, name: '회복 포션', desc: '포션 +1 (Q로 사용)' }
        : { type: 'heal', price: 55, sold: false, name: '붕대', desc: 'HP 40% 회복' },
    );
    this.shopItems = items;
    findMarkers(this.layout, 'S').forEach((m, i) => {
      const item = items[i];
      if (!item) return;
      const { x, y } = this.tileCenter(m.c, m.r);
      this.add.image(x, y + 8, 'pedestal', '0').setOrigin(0.5, 1).setDepth(DEPTH.actor + y);
      const iconName = item.type === 'relic' ? item.relic!.icon : item.type === 'boon' ? 'boon' : item.type === 'potion' ? 'potion' : 'heart';
      const icon = this.add.image(x, y - 6, 'icons', String(ICON[iconName])).setDepth(DEPTH.actor + y + 1);
      const price = this.add
        .text(x, y + 16, `${item.price}G`, { fontFamily: FONT_S, fontSize: '8px', color: toCss(C.gold0) })
        .setOrigin(0.5, 1)
        .setResolution(RENDER_SCALE)
        .setShadow(1, 1, '#181425', 0, false, true)
        .setDepth(DEPTH.text - 2);
      this.glows.push({ x, y: y - 6, r: 40, color: C.gold0, a: 0.6 });
      const it = new Interactable(x, y + 6, 18, `E 구매 — ${item.name} (${item.price}G)`, () => this.buy(item, it, [icon, price]));
      it.extra.icon = icon;
      this.interactables.push(it);
      this.tweens.add({ targets: icon, y: y - 8, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.InOut' });
    });
  }

  private setupFountain(): void {
    const m = findMarkers(this.layout, 'F')[0];
    if (!m) return;
    const { x, y } = this.tileCenter(m.c, m.r);
    const img = this.add.image(x, y + 10, 'fountain', '0').setOrigin(0.5, 1).setDepth(DEPTH.actor + y);
    this.time.addEvent({ delay: 300, loop: true, callback: () => img.setFrame(img.frame.name === '0' ? '1' : '0') });
    this.glows.push({ x, y: y - 4, r: 80, color: C.water1, a: 0.8 });
    const blk = this.walls.create(x, y + 4, 'px') as Phaser.Physics.Arcade.Sprite;
    blk.setVisible(false).setDisplaySize(24, 10).refreshBody();
    const it = new Interactable(x, y + 10, 24, 'E 샘물 마시기 — HP 40% 회복', () => {
      if (!it.enabled) return;
      it.enabled = false;
      this.player.heal(Math.round(this.player.maxHp * 0.4));
      this.vfx.ring(this.player.x, this.player.y, 4, 30, C.water1, 0.5, 2);
      this.vfx.spark(this.player.x, this.player.y - 10, C.water0, 20, 50, 80);
      playSfx('heal');
    });
    this.interactables.push(it);
  }

  // ───────────────────────── 웨이브 ─────────────────────────

  private buildWaves(spec: RoomSpec): void {
    const d = spec.depth;
    const elite = spec.kind === 'elite';
    const n = elite ? 2 : d <= 2 ? 1 : d <= 5 ? 2 : 3;
    const pool: EnemyKind[] = ['charger', 'shooter', 'bomber'];
    if (d >= 2) pool.push('shielder');
    if (d >= 3) pool.push('summoner');
    for (let w = 0; w < n; w++) {
      let budget = 5 + d * 1.3 + (elite ? 1 : 0) + w;
      const kinds: EnemyKind[] = [];
      let guard = 0;
      while (budget >= 2 && guard++ < 30) {
        const k = Phaser.Utils.Array.GetRandom(pool);
        const cost = ENEMY_DEFS[k].cost;
        if (cost > budget) continue;
        kinds.push(k);
        budget -= cost;
      }
      const elites = elite ? (w === n - 1 ? 2 : 1) : d >= 5 && Math.random() < 0.3 ? 1 : 0;
      this.waves.push({ kinds, elites });
    }
    this.waveCount = this.waves.length;
  }

  private spawnWave(): void {
    const plan = this.waves[this.waveIdx];
    if (!plan) return;
    this.waveIdx++;
    const els: Element[] = [];
    while (els.length < plan.kinds.length) els.push(...Phaser.Utils.Array.Shuffle([...ELEMENTS]));
    if (this.waveCount > 1) this.banner(`${this.waveIdx} / ${this.waveCount}`, 0xc0cbdc);
    plan.kinds.forEach((kind, i) => {
      const pos = this.randomSpawnPoint();
      const el = els[i];
      const delay = 0.7 + i * 0.12;
      this.pending++;
      this.vfx.telegraph(pos.x, pos.y, 10, ELEMENT_COLOR[el], delay);
      this.scheduler.after(delay, () => {
        this.pending--;
        if (this.player.dead) return;
        const opts: EnemyOpts = { elite: i < plan.elites ? Enemy.pickElite() : undefined };
        this.spawnEnemy(kind, el, pos.x, pos.y, opts);
      });
    });
  }

  spawnEnemy(kind: EnemyKind, el: Element, x: number, y: number, opts: EnemyOpts = {}): Enemy {
    const d = this.run?.depth ?? 1;
    const e = new Enemy(this, this.enemyGroup, kind, el, x, y, {
      hpMult: 1 + 0.08 * (d - 1),
      dmgMult: 1 + 0.05 * (d - 1),
      ...opts,
    });
    this.enemies.push(e);
    this.vfx.ring(x, y, 2, 18, ELEMENT_COLOR[el], 0.3, 2);
    this.vfx.glow(x, y - 8, 20, ELEMENT_COLOR[el], 0.4);
    this.lighting.flash(x, y, 60, ELEMENT_COLOR[el], 0.4);
    playSfx('spawn');
    return e;
  }

  /** 근처의 평범한 바닥 칸 (보상이 통로·웅덩이 위에 떨어지지 않게) */
  floorNear(x: number, y: number): { x: number; y: number } {
    for (let rad = 0; rad < 10; rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          const c = Math.floor(x / TILE) + dc;
          const r = Math.floor(y / TILE) + dr;
          if (c < 1 || r < 2 || c >= COLS - 1 || r >= ROWS - 1) continue;
          const k = this.terrain.kindAt(this.terrain.idx(c, r));
          if (k === 'floor' || k === 'ash') return this.tileCenter(c, r);
        }
      }
    }
    return { x, y };
  }

  randomSpawnPoint(): { x: number; y: number } {
    for (let k = 0; k < 100; k++) {
      const c = Phaser.Math.Between(1, COLS - 2);
      const r = Phaser.Math.Between(3, ROWS - 3);
      const kind = this.terrain.kindAt(this.terrain.idx(c, r));
      if (kind === 'wall' || kind === 'channel' || kind === 'puddle') continue;
      const x = c * TILE + TILE / 2;
      const y = r * TILE + TILE / 2;
      if (this.terrain.isBlocked(x, y, 7)) continue;
      if (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < 100) continue;
      return { x, y };
    }
    return { x: 60, y: 80 };
  }

  // ───────────────────────── 메인 루프 ─────────────────────────

  update(_time: number, delta: number): void {
    const realDt = Math.min(delta / 1000, MAX_DT);
    const stopped = this.hitstop.update(realDt);
    this.physics.world.isPaused = stopped;
    this.tweens.timeScale = stopped ? 0 : 1;

    if (!stopped) {
      const dt = realDt;
      this.gameTime += dt;
      if (this.run && this.state !== 'dead' && this.state !== 'victory') this.run.time += dt;
      this.engine.beginFrame();
      this.scheduler.update(dt);
      this.terrain.update(dt);
      this.fields.update(dt);
      this.applyTerrain(dt);
      this.player.update(dt);
      for (const e of [...this.enemies]) e.update(dt);
      this.boss?.update(dt);
      for (const d of this.dummies) d.update(dt);
      this.projectiles.update(dt);
      for (const p of this.pickups) p.update(dt);
      this.pickups = this.pickups.filter((p) => p.alive);
      this.lighting.update(dt);
      this.vfx.updateDebris(dt);
      this.enemies = this.enemies.filter((e) => !e.dead);
      this.updateWaves(dt);
      this.updateAmbient(dt);
    }

    this.updateCamera();
    this.player.syncVisuals();
    for (const e of this.enemies) e.syncVisuals();
    this.boss?.syncVisuals();
    for (const d of this.dummies) d.syncVisuals();
    for (const d of this.doors) d.update(this.gameTime);
    this.terrain.draw(this.gameTime);
    this.fields.draw(this.gameTime);
    this.updateInteraction();
    this.checkDoors();
    this.renderLights();
  }

  /** 마우스(화면 기준) 쪽으로 최대 28px 앞서 보기 — 부드럽게 보간 */
  private updateCamera(): void {
    const ptr = this.input.activePointer;
    const dx = Phaser.Math.Clamp((ptr.x - VIEW_W / 2) / (VIEW_W / 2), -1, 1);
    const dy = Phaser.Math.Clamp((ptr.y - VIEW_H / 2) / (VIEW_H / 2), -1, 1);
    const tx = this.player.dead || this.state === 'leaving' ? 0 : dx * 28;
    const ty = this.player.dead || this.state === 'leaving' ? 0 : dy * 18;
    this.lookX += (tx - this.lookX) * 0.08;
    this.lookY += (ty - this.lookY) * 0.08;
    this.cameras.main.setFollowOffset(-this.lookX, -this.lookY);
  }

  private updateWaves(dt: number): void {
    if (this.state !== 'play' || (this.mode !== 'combat' && this.mode !== 'elite')) return;
    const alive = this.enemies.filter((e) => !e.dead && e.kind !== 'wisp').length;
    if (this.waveIdx < this.waves.length) {
      if (this.pending === 0 && alive <= 1 && this.waveIdx > 0) {
        this.waveDelay += dt;
        if (this.waveDelay > 0.8) {
          this.waveDelay = 0;
          this.spawnWave();
        }
      }
      return;
    }
    if (this.pending === 0 && this.enemies.length === 0 && this.waveIdx > 0) this.onRoomCleared();
  }

  private updateAmbient(dt: number): void {
    this.emberT -= dt;
    if (this.emberT <= 0 && this.mode !== 'hub') {
      this.emberT = 0.12;
      const x = Math.random() * WORLD_W;
      const y = 40 + Math.random() * (WORLD_H - 50);
      this.vfx.spark(x, y, this.mode === 'boss' ? C.fire1 : Math.random() < 0.3 ? C.fire2 : C.stone2, 1, 6, 30);
    }
    if (this.mode === 'hub' && this.emberT <= 0) {
      this.emberT = 0.2;
      const el = Phaser.Utils.Array.GetRandom([...ELEMENTS]);
      this.vfx.spark(Math.random() * WORLD_W, 60 + Math.random() * (WORLD_H - 80), ELEMENT_LIGHT[el], 1, 5, 25);
    }
  }

  private renderLights(): void {
    const t = this.gameTime;
    for (const f of this.flames) {
      f.img.setFrame(String(Math.floor(t * 10 + f.ph) % 4));
      this.lighting.add(f.x, f.y + 8, 110 + Math.sin(t * 9 + f.ph) * 6, 0xe4a672, 0.85);
    }
    for (const g of this.glows) this.lighting.add(g.x, g.y, g.r + Math.sin(t * 3 + g.x) * 3, g.color, g.a);
    if (this.portalImgs.length) {
      const fr = String(Math.floor(t * 8) % 4);
      this.portalImgs[0].setFrame(fr);
      const el = ELEMENTS[Math.floor(t / 1.5) % 4];
      this.portalImgs[1].setTexture(`portal_elem_${el}`, fr);
      this.lighting.add(this.portalImgs[0].x, this.portalImgs[0].y - 24, 90, ELEMENT_COLOR[el], 0.9);
    }
    this.terrain.emitLights(this.lighting, t);
    this.fields.emitLights();
    this.projectiles.emitLights();
    this.lighting.render();
  }

  /** 지형은 플레이어에게도 똑같이 적용된다 */
  private applyTerrain(dt: number): void {
    for (const a of this.actorsOfTeam('all')) {
      if (a.isBoss) continue;
      const info = this.terrain.infoAt(a.x, a.y);
      a.onIce = info.fx === 'ice';
      if (info.kind === 'channel') a.push.add(new Phaser.Math.Vector2(info.dirX * CHANNEL_PUSH, info.dirY * CHANNEL_PUSH));
      a.terrainTickT -= dt;
      if (a.terrainTickT > 0) continue;
      a.terrainTickT = 0.5;
      const tfx = info.fx !== 'none' ? DATA.terrainEffects[info.fx] : undefined;
      if (tfx) {
        this.combat.hit(a, {
          damage: tfx.damage,
          element: tfx.attach,
          noStack: true,
          attachDuration: 1.5,
          environmental: true,
          color: colorOf(tfx.color),
        });
      } else if (info.kind === 'puddle' && info.fx === 'none') {
        this.engine.apply(a, 'water', { noStack: true, attachDuration: 1.5 });
      }
    }
  }

  // ───────────────────────── 상호작용·문 ─────────────────────────

  private updateInteraction(): void {
    const p = this.player;
    let best: Interactable | Pickup | null = null;
    let bd = 1e9;
    if (!p.dead && this.state !== 'leaving') {
      for (const it of this.interactables) {
        if (!it.enabled) continue;
        const d = Phaser.Math.Distance.Between(p.x, p.y, it.x, it.y);
        if (d < it.radius && d < bd) {
          bd = d;
          best = it;
        }
      }
      for (const pk of this.pickups) {
        if (pk.kind !== 'reward') continue;
        const d = Phaser.Math.Distance.Between(p.x, p.y, pk.x, pk.y);
        if (d < 18 && d < bd) {
          bd = d;
          best = pk;
        }
      }
    }
    this.promptTarget = best;
    if (best) {
      const text = best instanceof Pickup ? 'E 보상 받기' : best.prompt;
      this.prompt.setText(text).setPosition(Math.round(best.x), Math.round(best.y - (best instanceof Pickup ? 22 : 34))).setVisible(true);
      if (Phaser.Input.Keyboard.JustDown(this.keyE)) {
        if (best instanceof Pickup) best.collect();
        else best.use();
      }
    } else this.prompt.setVisible(false);
  }

  private checkDoors(): void {
    if (this.state !== 'cleared' || this.player.dead) return;
    for (const d of this.doors) {
      if (d.spec && d.contains(this.player.x, this.player.y)) {
        this.leaveTo(d.spec);
        return;
      }
    }
  }

  private onRoomCleared(): void {
    this.state = 'cleared';
    const run = this.run!;
    this.banner('방 클리어', 0xc0cbdc);
    this.lighting.flash(this.player.x, this.player.y, 200, 0xffffff, 0.5);
    this.hitstop.request(0.15);
    playSfx('select');
    const reward = run.room.reward;
    const { x: cx, y: cy } = this.floorNear(WORLD_W / 2, WORLD_H / 2);
    if (reward === 'boon' || reward === 'relic') {
      this.scheduler.after(0.5, () => {
        this.pickups.push(new Pickup(this, 'reward', cx, cy, 0, reward));
        this.vfx.ring(cx, cy, 4, 30, REWARD_COLOR[reward], 0.5, 2);
        playSfx('pickup');
      });
    } else {
      const total = 40 + run.depth * 6;
      for (let i = 0; i < 10; i++) this.pickups.push(new Pickup(this, 'coin', cx, cy, Math.round(total / 10)));
      this.scheduler.after(0.6, () => this.openDoors());
    }
  }

  private openDoors(): void {
    const run = this.run;
    if (!run) return;
    const opts = doorOptions(run);
    const slots = opts.length === 1 ? [1] : opts.length === 2 ? [0, 2] : [0, 1, 2];
    opts.forEach((spec, i) => this.doors[slots[i]]?.openWith(spec));
    this.state = 'cleared';
  }

  private leaveTo(spec: RoomSpec): void {
    if (!this.run) return;
    this.state = 'leaving';
    this.saveRunState();
    enterRoom(this.run, spec);
    playSfx('door');
    this.player.inputLocked = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart({}));
  }

  private saveRunState(): void {
    if (!this.run) return;
    this.run.hp = Math.max(1, this.player.hp);
    this.run.potions = this.player.potions;
    this.registry.set('element', this.player.element);
  }

  private beginRun(): void {
    if (this.state === 'leaving') return;
    this.state = 'leaving';
    this.registry.set('element', this.player.element);
    startRun();
    playSfx('portal');
    this.player.inputLocked = true;
    this.vfx.ring(this.player.x, this.player.y, 30, 2, 0xc0cbdc, 0.5, 2);
    this.cameras.main.fadeOut(600, 255, 255, 255);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart({}));
  }

  // ───────────────────────── 보상·상점 ─────────────────────────

  requestUi(req: UiRequest): void {
    this.game.events.emit('ui:open', req);
  }

  onPickup(p: Pickup): void {
    const run = this.run;
    if (p.kind === 'coin') {
      if (run) run.gold += p.value;
      playSfx('coin');
    } else if (p.kind === 'essence') {
      if (run) run.essence += p.value;
      this.vfx.floatText(this.player.x, this.player.y - 26, '+정수', 0xc0cbdc, 6, 0.6, 10);
      playSfx('pickup');
    } else if (p.kind === 'heart') {
      this.player.heal(p.value);
      playSfx('heal');
    } else if (p.kind === 'reward' && run) {
      playSfx('pickup');
      this.vfx.ring(p.x, p.y, 4, 40, REWARD_COLOR[p.reward ?? 'boon'], 0.4, 2);
      if (p.reward === 'relic') {
        const opts = rollRelics(run, 3);
        if (opts.length && run.relics.length < MAX_RELICS) this.requestUi({ type: 'relics', options: opts });
        else {
          run.gold += 80;
          this.openDoors();
        }
      } else this.requestUi({ type: 'boons', options: rollBoons(run, 3), source: 'reward' });
    }
  }

  applyBoon(id: string, source: 'reward' | 'shop'): void {
    const run = this.run;
    if (!run) return;
    run.boons[id] = (run.boons[id] ?? 0) + 1;
    this.engine.mods = computeMods(run);
    const b = BOONS.find((x) => x.id === id);
    this.player.empowered = Math.max(this.player.empowered, 0);
    this.vfx.ring(this.player.x, this.player.y - 6, 4, 34, 0xfee761, 0.5, 2);
    this.vfx.spark(this.player.x, this.player.y - 10, 0xfee761, 20, 60, 90);
    if (b) this.vfx.floatText(this.player.x, this.player.y - 30, b.name, 0xfee761, 6, 1, 16, true);
    playSfx('select');
    if (source === 'reward') this.openDoors();
  }

  applyRelic(id: string): void {
    const run = this.run;
    if (!run) return;
    if (!run.relics.includes(id)) run.relics.push(id);
    this.engine.mods = computeMods(run);
    const r = RELICS.find((x) => x.id === id);
    this.vfx.ring(this.player.x, this.player.y - 6, 4, 34, C.water0, 0.5, 2);
    if (r) this.vfx.floatText(this.player.x, this.player.y - 30, r.name, C.water0, 6, 1, 16, true);
    playSfx('select');
    if (this.mode === 'elite') this.openDoors();
  }

  skipReward(source: 'reward' | 'shop'): void {
    if (source === 'reward') this.openDoors();
  }

  private buy(item: ShopItem, it: Interactable, objs: Phaser.GameObjects.GameObject[]): void {
    const run = this.run;
    if (!run || item.sold) return;
    if (run.gold < item.price) {
      this.vfx.floatText(this.player.x, this.player.y - 28, '골드가 부족해요', C.blood, 6, 0.7, 10);
      playSfx('deny');
      return;
    }
    run.gold -= item.price;
    item.sold = true;
    it.enabled = false;
    for (const o of objs) o.destroy();
    playSfx('buy');
    if (item.type === 'relic' && item.relic) this.applyRelic(item.relic.id);
    else if (item.type === 'boon') this.requestUi({ type: 'boons', options: rollBoons(run, 3), source: 'shop' });
    else if (item.type === 'potion') this.player.potions++;
    else this.player.heal(Math.round(this.player.maxHp * 0.4));
  }

  // ───────────────────────── 이벤트 훅 ─────────────────────────

  recordReaction(id: string): void {
    if (!this.run) return;
    this.run.stats.reactions++;
    this.run.stats.byReaction[id] = (this.run.stats.byReaction[id] ?? 0) + 1;
  }

  recordPerfect(): void {
    if (this.run) this.run.stats.perfect++;
  }

  onWallSlam(a: Actor): void {
    this.vfx.dust(a.x, a.y, 6);
    if (a.team === 'enemy' && this.engine.mods.flags.has('overload_wallslam')) {
      this.vfx.floatText(a.x, a.y - a.height - 8, '벽치기!', 0xead4aa, 6, 0.6, 10, true);
      this.combat.hit(a, { damage: 15 * this.player.atkMult, color: 0xead4aa });
      this.shake(0.1, 0.006);
      playSfx('slam');
    }
  }

  onEnemyDeath(e: Enemy, exploded: boolean): void {
    const run = this.run;
    const m = this.engine.mods;
    const h = e.lastHit;
    if (h?.reactionId === 'electro_charged' && m.flags.has('electro_water_on_kill')) {
      for (const o of this.combat.inCircle(e.x, e.y, 55, 'enemy')) this.engine.apply(o, 'water', { noStack: true });
      this.vfx.ring(e.x, e.y, 4, 55, C.water1, 0.3, 2);
    }
    if (e.frozenT > 0 && m.flags.has('freeze_spread_on_kill')) {
      for (const o of this.combat.inCircle(e.x, e.y, 48, 'enemy')) o.freeze(1.5);
      this.vfx.ring(e.x, e.y, 4, 48, C.water0, 0.3, 2);
    }
    if (e.elite === 'split' && !e.small) {
      for (let k = 0; k < 2; k++) {
        const x = e.x + (k ? 8 : -8);
        if (!this.terrain.isBlocked(x, e.y, 5)) this.spawnEnemy(e.kind === 'wisp' ? 'charger' : e.kind, e.element, x, e.y, { small: true });
      }
    }
    if (!run || exploded) return;
    run.stats.kills++;
    const gold = Math.round(ENEMY_DEFS[e.kind].gold * (e.elite ? 3 : 1) * (0.8 + Math.random() * 0.5));
    for (let i = 0; i < Math.ceil(gold / 2); i++) this.pickups.push(new Pickup(this, 'coin', e.x, e.y, 2));
    if (e.elite) for (let i = 0; i < 2; i++) this.pickups.push(new Pickup(this, 'essence', e.x, e.y, 1));
    if (Math.random() < 0.05) this.pickups.push(new Pickup(this, 'heart', e.x, e.y, 10));
  }

  onBossDefeated(b: Golem): void {
    const run = this.run;
    if (this.state === 'dead') return;
    this.projectiles.clearTeam('enemy');
    for (const e of this.enemies) if (!e.dead) e.die();
    this.banner('잿불 골렘 격파!', C.fire0);
    for (let i = 0; i < 15; i++) this.pickups.push(new Pickup(this, 'essence', b.x, b.y, 1));
    for (let i = 0; i < 20; i++) this.pickups.push(new Pickup(this, 'coin', b.x, b.y, 3));
    if (run) run.stats.kills++;
    this.state = 'victory';
    this.scheduler.after(3.5, () => {
      this.saveRunState();
      this.requestUi({ type: 'result', victory: true });
    });
  }

  onPlayerDeath(): void {
    if (this.state === 'victory') return;
    this.state = 'dead';
    this.shake(0.4, 0.012);
    playMusic('none');
    this.time.delayedCall(1800, () => this.requestUi({ type: 'result', victory: false }));
  }

  /** 결과 화면 확인 → 런 종료 (정수·숙련도는 메타로) → 성소 */
  finishRun(victory: boolean): void {
    endRun(victory);
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart({ hub: true }));
  }

  private onToggleTrial(): void {
    if (this.mode !== 'hub') return;
    this.trial = !this.trial;
    this.engine.secondaryUnlocked = this.trial ? new Set(DATA.secondary.map((s) => s.id)) : new Set(meta.secondary);
    this.banner(this.trial ? '2차 반응 체험 모드 (성소 안에서만)' : '체험 모드 끔', 0xead4aa);
  }

  private onDevKey(ev: KeyboardEvent): void {
    if (ev.key === 'k') {
      meta.essence += 50;
      saveMeta();
      this.banner('개발: 정수 +50', 0xc0cbdc);
    } else if (ev.key === 'n' && this.run && this.state === 'play') {
      this.waveIdx = this.waves.length;
      this.pending = 0;
      this.scheduler.clear();
      for (const e of this.enemies) e.die();
    } else if (ev.key === 'g' && this.run) {
      this.run.gold += 200;
    } else if (ev.key === 'b' && this.run) {
      this.leaveTo({ kind: 'boss', reward: 'boss', template: 'boss', depth: REGION.length });
    } else if (ev.key === 'j' && this.run) {
      this.leaveTo(doorOptions(this.run)[0]);
    }
  }

  // ───────────────────────── 공용 ─────────────────────────

  actorsOfTeam(team: Team | 'all'): Actor[] {
    const foes: Actor[] = this.enemies.filter((e) => !e.dead);
    if (this.boss && !this.boss.dead) foes.push(this.boss);
    for (const d of this.dummies) foes.push(d);
    const p = this.player && !this.player.dead ? [this.player] : [];
    if (team === 'player') return p;
    if (team === 'enemy') return foes;
    return [...p, ...foes];
  }

  pointerWorld(): Phaser.Math.Vector2 {
    const p = this.input.activePointer;
    return this.cameras.main.getWorldPoint(p.x, p.y);
  }

  shake(dur: number, intensity: number): void {
    this.cameras.main.shake(dur * 1000, intensity);
  }

  banner(text: string, color: number): void {
    this.game.events.emit('banner', text, color);
  }
}
