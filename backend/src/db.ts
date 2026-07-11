import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

export const db: Database.Database = new Database(join(config.dataDir, 'dogroo.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 그룹 자동 분류 규칙 - 이름·학명에 키워드가 포함되면 해당 그룹 (풀에 없는 종용)
// 그룹 = 유통 속/계열 단위. 순서 중요: 구체적인 룰(에피프레넘·무화과·홍콩야자·산세베리아 등)이 넓은 룰보다 먼저
const GROUP_RULES: [RegExp, string][] = [
  [/몬스테라|아단소니|Monstera/i, '몬스테라'],
  [/필로덴드론|Philodendron|Thaumatophyllum/i, '필로덴드론'],
  [/에피프레넘|피나텀|세부블루|pinnatum|Cebu Blue/i, '에피프레넘'],
  [/스킨답서스|포토스|Scindapsus|Epipremnum|Pothos/i, '스킨답서스'],
  [/싱고니움|Syngonium|Arrowhead/i, '싱고니움'],
  [/알로카시아|Alocasia/i, '알로카시아'],
  [/안스리움|Anthurium/i, '안스리움'],
  [/아글라오네마|Aglaonema/i, '아글라오네마'],
  [/디펜바키아|Dieffenbachia/i, '디펜바키아'],
  [/스파티필름|Spathiphyllum/i, '스파티필름'],
  [/금전수|Zamioculcas/i, '금전수'],
  [/라피도포라|Rhaphidophora/i, '라피도포라'],
  [/칼라테아|Calathea|Goeppertia/i, '칼라테아'],
  [/마란타|Maranta/i, '마란타'],
  [/스트로만테|Stromanthe/i, '스트로만테'],
  [/크테난테|Ctenanthe/i, '크테난테'],
  [/무화과|Ficus carica/i, '무화과나무'],
  [/고무나무|모람|푸미라|짜보|벤자민|Ficus|Fig/i, '피쿠스'],
  [/쉐프렐라|홍콩야자|Schefflera/i, '쉐프렐라'],
  [/파키라|Pachira/i, '파키라'],
  [/브레이니아|Breynia/i, '브레이니아'],
  [/소포라|Sophora/i, '소포라'],
  [/소철|Cycas/i, '소철'],
  [/극락조|Strelitzia/i, '극락조'],
  [/여인초|Ravenala/i, '여인초'],
  [/야자|관음죽|종려|[Pp]alm|Chamaedorea|Dypsis|Howea|Rhapis|Phoenix roebelenii/i, '야자'],
  [/산세베리아|스투키|Sansevieria|trifasciata|angolensis|Snake [Pp]lant/i, '산세베리아'],
  [/유카|Yucca/i, '유카'],
  [/드라세나|행운목|Dracaena/i, '드라세나'],
  [/아이비|헤데라|Hedera|Ivy/i, '아이비'],
  [/호야|Hoya/i, '호야'],
  [/페페로미아|Peperomia/i, '페페로미아'],
  [/필레아|Pilea/i, '필레아'],
  [/베고니아|Begonia/i, '베고니아'],
  [/피토니아|Fittonia/i, '피토니아'],
  [/틸란드시아|Tillandsia/i, '틸란드시아'],
  [/립살리스|Rhipsalis/i, '립살리스'],
  [/디시디아|디스키디아|Dischidia/i, '디시디아'],
  [/러브체인|Ceropegia/i, '러브체인'],
  [/접란|나비란|Chlorophytum/i, '접란'],
  [/고사리|아디안텀|박쥐란|아비스|펀\b|Fern|Adiantum|Platycerium|Asplenium|Nephrolepis/i, '고사리'],
  [/로즈마리|[Rr]osmarinus|Rosemary/i, '로즈마리'],
  [/장미허브|Plectranthus/i, '장미허브'],
  [/민트|Mentha|Mint/i, '민트'],
  [/라벤더|Lavandula|Lavender/i, '라벤더'],
  [/바질|Ocimum|Basil/i, '바질'],
  [/유칼립투스|Eucalyptus/i, '유칼립투스'],
  [/율마|Goldcrest/i, '율마'],
  [/커피나무|Coffea/i, '커피나무'],
  [/올리브|Olea/i, '올리브나무'],
  [/자스민|재스민|Jasmin/i, '자스민'],
  [/제라늄|구문초|Pelargonium/i, '제라늄'],
  [/선인장|에케베리아|하월시아|염좌|세덤|알로에|칼랑코에|카랑코에|리톱스|아가베|유포르비아|아데니움|파키포디움|스테파니아|시조바시스|꿩의비름|녹영|다육|Cactus|Aloe|Echeveria|Sedum|Adenium|Kalanchoe|Curio/i, '다육·선인장'],
  [/호접란|만천홍|덴드로비움|풍란|난초|Phalaenopsis|Orchid|Dendrobium/i, '난초'],
];

// 스키마 + 식물 풀 적용 (IF NOT EXISTS / ON CONFLICT 기반이라 기동 시마다 실행해도 안전)
export function migrate(): void {
  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf-8');
  db.exec(schema);
  // 기존 DB에 없는 컬럼 추가
  const speciesCols = db.prepare('PRAGMA table_info(species)').all() as { name: string }[];
  if (!speciesCols.some((c) => c.name === 'name_en')) {
    db.exec('ALTER TABLE species ADD COLUMN name_en TEXT');
  }
  if (!speciesCols.some((c) => c.name === 'group_name')) {
    db.exec('ALTER TABLE species ADD COLUMN group_name TEXT');
  }
  const plantCols = db.prepare('PRAGMA table_info(plants)').all() as { name: string }[];
  if (!plantCols.some((c) => c.name === 'pot_type')) {
    db.exec('ALTER TABLE plants ADD COLUMN pot_type TEXT');
  }

  // 그룹은 파생 데이터(수동 편집 없음) - 매 기동 시 전체 종을 룰로 재계산한 뒤
  // 풀을 적용해 풀 종은 풀의 그룹이 최종 우선이 되게 한다 (결정적·멱등)
  const allSpecies = db
    .prepare('SELECT id, name, COALESCE(name_en, \'\') AS name_en FROM species')
    .all() as { id: number; name: string; name_en: string }[];
  const setGroup = db.prepare('UPDATE species SET group_name = ? WHERE id = ?');
  for (const s of allSpecies) {
    const target = `${s.name} ${s.name_en}`;
    const rule = GROUP_RULES.find(([pattern]) => pattern.test(target));
    setGroup.run(rule ? rule[1] : '기타', s.id);
  }

  const pool = readFileSync(new URL('./species-pool.sql', import.meta.url), 'utf-8');
  db.exec(pool);
}
