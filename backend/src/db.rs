use std::sync::LazyLock;

use regex::Regex;

use crate::config::CONFIG;
use crate::core::db::{self, Result};
use crate::params;

const SCHEMA: &str = include_str!("schema.sql");
const POOL: &str = include_str!("species-pool.sql");

pub fn open() -> Result<()> {
    db::open(&format!("{}/dogroo.db", CONFIG.data_dir))
}

// 그룹 자동 분류 규칙 - 이름·학명에 키워드가 포함되면 해당 그룹 (풀에 없는 종용)
// 그룹 = 유통 속/계열 단위. 순서 중요: 구체적인 룰(에피프레넘·무화과·홍콩야자·산세베리아 등)이 넓은 룰보다 먼저
// (JS 정규식 /…/i 그대로. \b 는 JS 처럼 ASCII 단어 경계)
const GROUP_RULES: &[(&str, &str)] = &[
    (r"몬스테라|아단소니|Monstera", "몬스테라"),
    (r"필로덴드론|Philodendron|Thaumatophyllum", "필로덴드론"),
    (
        r"에피프레넘|피나텀|세부블루|pinnatum|Cebu Blue",
        "에피프레넘",
    ),
    (
        r"스킨답서스|포토스|Scindapsus|Epipremnum|Pothos",
        "스킨답서스",
    ),
    (r"싱고니움|Syngonium|Arrowhead", "싱고니움"),
    (r"알로카시아|Alocasia", "알로카시아"),
    (r"안스리움|Anthurium", "안스리움"),
    (r"아글라오네마|Aglaonema", "아글라오네마"),
    (r"디펜바키아|Dieffenbachia", "디펜바키아"),
    (r"스파티필름|Spathiphyllum", "스파티필름"),
    (r"금전수|Zamioculcas", "금전수"),
    (r"라피도포라|Rhaphidophora", "라피도포라"),
    (r"칼라테아|Calathea|Goeppertia", "칼라테아"),
    (r"마란타|Maranta", "마란타"),
    (r"스트로만테|Stromanthe", "스트로만테"),
    (r"크테난테|Ctenanthe", "크테난테"),
    (r"무화과|Ficus carica", "무화과나무"),
    (r"고무나무|모람|푸미라|짜보|벤자민|Ficus|Fig", "피쿠스"),
    (r"쉐프렐라|홍콩야자|Schefflera", "쉐프렐라"),
    (r"파키라|Pachira", "파키라"),
    (r"브레이니아|Breynia", "브레이니아"),
    (r"소포라|Sophora", "소포라"),
    (r"소철|Cycas", "소철"),
    (r"극락조|Strelitzia", "극락조"),
    (r"여인초|Ravenala", "여인초"),
    (
        r"야자|관음죽|종려|[Pp]alm|Chamaedorea|Dypsis|Howea|Rhapis|Phoenix roebelenii",
        "야자",
    ),
    (
        r"산세베리아|스투키|Sansevieria|trifasciata|angolensis|Snake [Pp]lant",
        "산세베리아",
    ),
    (r"유카|Yucca", "유카"),
    (r"드라세나|행운목|Dracaena", "드라세나"),
    (r"아이비|헤데라|Hedera|Ivy", "아이비"),
    (r"호야|Hoya", "호야"),
    (r"페페로미아|Peperomia", "페페로미아"),
    (r"필레아|Pilea", "필레아"),
    (r"베고니아|Begonia", "베고니아"),
    (r"피토니아|Fittonia", "피토니아"),
    (r"틸란드시아|Tillandsia", "틸란드시아"),
    (r"립살리스|Rhipsalis", "립살리스"),
    (r"디시디아|디스키디아|Dischidia", "디시디아"),
    (r"러브체인|Ceropegia", "러브체인"),
    (r"접란|나비란|Chlorophytum", "접란"),
    (
        r"고사리|아디안텀|박쥐란|아비스|펀\b|Fern|Adiantum|Platycerium|Asplenium|Nephrolepis",
        "고사리",
    ),
    (r"로즈마리|[Rr]osmarinus|Rosemary", "로즈마리"),
    (r"장미허브|Plectranthus", "장미허브"),
    (r"민트|Mentha|Mint", "민트"),
    (r"라벤더|Lavandula|Lavender", "라벤더"),
    (r"바질|Ocimum|Basil", "바질"),
    (r"유칼립투스|Eucalyptus", "유칼립투스"),
    (r"율마|Goldcrest", "율마"),
    (r"커피나무|Coffea", "커피나무"),
    (r"올리브|Olea", "올리브나무"),
    (r"자스민|재스민|Jasmin", "자스민"),
    (r"제라늄|구문초|Pelargonium", "제라늄"),
    (
        r"선인장|에케베리아|하월시아|염좌|세덤|알로에|칼랑코에|카랑코에|리톱스|아가베|유포르비아|아데니움|파키포디움|스테파니아|시조바시스|꿩의비름|녹영|다육|Cactus|Aloe|Echeveria|Sedum|Adenium|Kalanchoe|Curio",
        "다육·선인장",
    ),
    (
        r"호접란|만천홍|덴드로비움|풍란|난초|Phalaenopsis|Orchid|Dendrobium",
        "난초",
    ),
];

static RULES: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    GROUP_RULES
        .iter()
        .map(|(p, g)| {
            (
                Regex::new(&format!("(?i){}", p.replace(r"\b", r"(?-u:\b)"))).expect("group rule"),
                *g,
            )
        })
        .collect()
});

pub fn group_of(target: &str) -> &'static str {
    RULES
        .iter()
        .find(|(re, _)| re.is_match(target))
        .map(|(_, g)| *g)
        .unwrap_or("기타")
}

// 스키마 + 식물 풀 적용 (IF NOT EXISTS / ON CONFLICT 기반이라 기동 시마다 실행해도 안전)
pub fn migrate() -> Result<()> {
    let c = db::conn();
    db::exec(&c, SCHEMA)?;
    // 기존 DB에 없는 컬럼 추가
    let species_cols = db::columns(&c, "species")?;
    if !species_cols.iter().any(|x| x == "name_en") {
        db::exec(&c, "ALTER TABLE species ADD COLUMN name_en TEXT")?;
    }
    if !species_cols.iter().any(|x| x == "group_name") {
        db::exec(&c, "ALTER TABLE species ADD COLUMN group_name TEXT")?;
    }
    if !db::columns(&c, "plants")?.iter().any(|x| x == "pot_type") {
        db::exec(&c, "ALTER TABLE plants ADD COLUMN pot_type TEXT")?;
    }

    // 그룹은 파생 데이터(수동 편집 없음) - 매 기동 시 전체 종을 룰로 재계산한 뒤
    // 풀을 적용해 풀 종은 풀의 그룹이 최종 우선이 되게 한다 (결정적·멱등)
    let all = db::all(
        &c,
        "SELECT id, name, COALESCE(name_en, '') AS name_en FROM species",
        params![],
    )?;
    for s in all {
        let target = format!(
            "{} {}",
            db::text(&s, "name").unwrap_or(""),
            db::text(&s, "name_en").unwrap_or("")
        );
        db::run(
            &c,
            "UPDATE species SET group_name = ? WHERE id = ?",
            params![group_of(&target), db::int(&s, "id")],
        )?;
    }
    db::exec(&c, POOL)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_like_js() {
        assert_eq!(
            group_of("몬스테라 델리시오사 Monstera deliciosa"),
            "몬스테라"
        );
        assert_eq!(group_of("x ficus carica"), "무화과나무");
        assert_eq!(group_of("보스턴 펀 "), "기타"); // JS: '펀' 뒤 \b 는 단어 문자가 와야 성립
        assert_eq!(group_of("보스턴 펀X"), "고사리");
        assert_eq!(group_of("anything"), "기타");
    }
}
