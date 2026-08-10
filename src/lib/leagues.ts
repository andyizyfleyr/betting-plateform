/**
 * Base de données des ligues réelles et de leurs clubs (pour l'admin).
 * Utilisée pour pré-remplir les champs « Ligue » et « Équipe » lors de
 * l'ajout manuel d'un match : choisir la Liga filtre les clubs proposés.
 * Logo = blason officiel du club via l'API Wikipedia (summary → thumbnail),
 * donc le nom du fichier correspond au club (source fiable) ; en cas d'échec
 * de chargement, l'avatar monogramme prend le relais.
 */

export interface LeagueClub {
  name: string;
  logo: string | null;
}

export interface LeagueDef {
  id: string;
  name: string;
  country: string;
  clubs: LeagueClub[];
}

export const LEAGUES: LeagueDef[] = [
  {
    id: "liga",
    name: "Liga",
    country: "Espagne",
    clubs: [
      { name: "Alavés", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/f/f8/Deportivo_Alaves_logo_%282020%29.svg/330px-Deportivo_Alaves_logo_%282020%29.svg.png" },
      { name: "Athletic Bilbao", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/9/98/Club_Athletic_Bilbao_logo.svg/330px-Club_Athletic_Bilbao_logo.svg.png" },
      { name: "Atlético Madrid", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/f/f9/Atletico_Madrid_Logo_2024.svg/330px-Atletico_Madrid_Logo_2024.svg.png" },
      { name: "FC Barcelone", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/4/47/FC_Barcelona_%28crest%29.svg/330px-FC_Barcelona_%28crest%29.svg.png" },
      { name: "Celta Vigo", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/1/12/RC_Celta_de_Vigo_logo.svg/330px-RC_Celta_de_Vigo_logo.svg.png" },
      { name: "Espanyol", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/9/92/RCD_Espanyol_crest.svg/330px-RCD_Espanyol_crest.svg.png" },
      { name: "Getafe", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/4/46/Getafe_logo.svg/330px-Getafe_logo.svg.png" },
      { name: "Gérone", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/f/f7/Girona_FC_Logo.svg/330px-Girona_FC_Logo.svg.png" },
      { name: "Las Palmas", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/2/20/UD_Las_Palmas_logo.svg/330px-UD_Las_Palmas_logo.svg.png" },
      { name: "Leganés", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/b/b8/Club_Deportivo_Legan%C3%A9s_logo.svg/330px-Club_Deportivo_Legan%C3%A9s_logo.svg.png" },
      { name: "RCD Majorque", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/e/e0/Rcd_mallorca.svg/330px-Rcd_mallorca.svg.png" },
      { name: "CA Osasuna", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/3/38/CA_Osasuna_2024_crest.svg/330px-CA_Osasuna_2024_crest.svg.png" },
      { name: "Rayo Vallecano", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/d/d8/Rayo_Vallecano_logo.svg/330px-Rayo_Vallecano_logo.svg.png" },
      { name: "Real Betis", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/2/2f/Real_Betis_2022_logo.svg/330px-Real_Betis_2022_logo.svg.png" },
      { name: "Real Madrid", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/5/56/Real_Madrid_CF.svg/330px-Real_Madrid_CF.svg.png" },
      { name: "Real Sociedad", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/f/f1/Real_Sociedad_logo.svg/330px-Real_Sociedad_logo.svg.png" },
      { name: "FC Séville", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/3/3b/Sevilla_FC_logo.svg/330px-Sevilla_FC_logo.svg.png" },
      { name: "Valence", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/c/ce/Valenciacf.svg/330px-Valenciacf.svg.png" },
      { name: "Real Valladolid", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/a/a9/Real_Valladolid_CF_crest.svg/330px-Real_Valladolid_CF_crest.svg.png" },
      { name: "Villarreal", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/b/b9/Villarreal_CF_logo-en.svg/330px-Villarreal_CF_logo-en.svg.png" },
    ],
  },
  {
    id: "premier-league",
    name: "Premier League",
    country: "Angleterre",
    clubs: [
      { name: "Arsenal", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/5/53/Arsenal_FC.svg/330px-Arsenal_FC.svg.png" },
      { name: "Aston Villa", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/9/9a/Aston_Villa_FC_new_crest.svg/330px-Aston_Villa_FC_new_crest.svg.png" },
      { name: "Bournemouth", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/e/e5/AFC_Bournemouth_%282013%29.svg/330px-AFC_Bournemouth_%282013%29.svg.png" },
      { name: "Brentford", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/2/2a/Brentford_FC_crest.svg/330px-Brentford_FC_crest.svg.png" },
      { name: "Brighton", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/d/d0/Brighton_and_Hove_Albion_FC_crest.svg/330px-Brighton_and_Hove_Albion_FC_crest.svg.png" },
      { name: "Chelsea", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/c/cc/Chelsea_FC.svg/330px-Chelsea_FC.svg.png" },
      { name: "Crystal Palace", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/a/a2/Crystal_Palace_FC_logo_%282022%29.svg/330px-Crystal_Palace_FC_logo_%282022%29.svg.png" },
      { name: "Everton", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/7/7c/Everton_FC_logo.svg/330px-Everton_FC_logo.svg.png" },
      { name: "Fulham", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/e/eb/Fulham_FC_%28shield%29.svg/330px-Fulham_FC_%28shield%29.svg.png" },
      { name: "Ipswich Town", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/4/43/Ipswich_Town.svg/330px-Ipswich_Town.svg.png" },
      { name: "Leicester City", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/2/2d/Leicester_City_crest.svg/330px-Leicester_City_crest.svg.png" },
      { name: "Liverpool", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/0/0c/Liverpool_FC.svg/330px-Liverpool_FC.svg.png" },
      { name: "Manchester City", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/e/eb/Manchester_City_FC_badge.svg/330px-Manchester_City_FC_badge.svg.png" },
      { name: "Manchester United", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/7/7a/Manchester_United_FC_crest.svg/330px-Manchester_United_FC_crest.svg.png" },
      { name: "Newcastle", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/5/56/Newcastle_United_Logo.svg/330px-Newcastle_United_Logo.svg.png" },
      { name: "Nottingham Forest", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/e/e5/Nottingham_Forest_F.C._logo.svg/330px-Nottingham_Forest_F.C._logo.svg.png" },
      { name: "Southampton", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/c/c9/FC_Southampton.svg/330px-FC_Southampton.svg.png" },
      { name: "Tottenham", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/b/b4/Tottenham_Hotspur.svg/330px-Tottenham_Hotspur.svg.png" },
      { name: "West Ham", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/c/c2/West_Ham_United_FC_logo.svg/330px-West_Ham_United_FC_logo.svg.png" },
      { name: "Wolverhampton", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/c/c9/Wolverhampton_Wanderers_FC_crest.svg/330px-Wolverhampton_Wanderers_FC_crest.svg.png" },
    ],
  },
  {
    id: "ligue-1",
    name: "Ligue 1",
    country: "France",
    clubs: [
      { name: "Angers", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Angers_Sporting_Club_de_l%27Ouest_logo.svg/330px-Angers_Sporting_Club_de_l%27Ouest_logo.svg.png" },
      { name: "Auxerre", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/5/51/AJAuxerreLogo.svg/330px-AJAuxerreLogo.svg.png" },
      { name: "Brest", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/0/05/Stade_Brestois_29_logo.svg/330px-Stade_Brestois_29_logo.svg.png" },
      { name: "Le Havre", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/f/fc/Le_Havre_AC_logo.svg/330px-Le_Havre_AC_logo.svg.png" },
      { name: "Lens", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/c/cc/RC_Lens_logo.svg/330px-RC_Lens_logo.svg.png" },
      { name: "Lille", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/3/3f/Lille_OSC_2018_logo.svg/330px-Lille_OSC_2018_logo.svg.png" },
      { name: "Lyon", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/1/1c/Olympique_Lyonnais_logo.svg/330px-Olympique_Lyonnais_logo.svg.png" },
      { name: "Marseille", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Olympique_de_Marseille_2026_logo.svg/330px-Olympique_de_Marseille_2026_logo.svg.png" },
      { name: "Monaco", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/c/cf/LogoASMonacoFC2021.svg/330px-LogoASMonacoFC2021.svg.png" },
      { name: "Montpellier", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/a/a8/Montpellier_HSC_logo.svg/330px-Montpellier_HSC_logo.svg.png" },
      { name: "Nantes", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Logo_FC_Nantes_%28avec_fond%29_-_2019.svg/330px-Logo_FC_Nantes_%28avec_fond%29_-_2019.svg.png" },
      { name: "Nice", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/2/2e/OGC_Nice_logo.svg/330px-OGC_Nice_logo.svg.png" },
      { name: "Paris SG", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/a/a7/Paris_Saint-Germain_F.C..svg/330px-Paris_Saint-Germain_F.C..svg.png" },
      { name: "Reims", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/19/Stade_de_Reims_logo.svg/330px-Stade_de_Reims_logo.svg.png" },
      { name: "Rennes", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/9/9e/Stade_Rennais_FC.svg/330px-Stade_Rennais_FC.svg.png" },
      { name: "Saint-Étienne", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/2/25/AS_Saint-%C3%89tienne_logo.svg/330px-AS_Saint-%C3%89tienne_logo.svg.png" },
      { name: "Strasbourg", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/8/80/Racing_Club_de_Strasbourg_logo.svg/330px-Racing_Club_de_Strasbourg_logo.svg.png" },
      { name: "Toulouse", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/6/63/Toulouse_FC_2018_logo.svg/330px-Toulouse_FC_2018_logo.svg.png" },
    ],
  },
  {
    id: "bundesliga",
    name: "Bundesliga",
    country: "Allemagne",
    clubs: [
      { name: "Augsbourg", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/c/c5/FC_Augsburg_logo.svg/330px-FC_Augsburg_logo.svg.png" },
      { name: "Bayern Munich", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/FC_Bayern_M%C3%BCnchen_logo_%282024%29.svg/330px-FC_Bayern_M%C3%BCnchen_logo_%282024%29.svg.png" },
      { name: "Bochum", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/72/VfL_Bochum_logo.svg/330px-VfL_Bochum_logo.svg.png" },
      { name: "Dortmund", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/Borussia_Dortmund_logo.svg/330px-Borussia_Dortmund_logo.svg.png" },
      { name: "Eintracht Francfort", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/7/7e/Eintracht_Frankfurt_crest.svg/330px-Eintracht_Frankfurt_crest.svg.png" },
      { name: "Fribourg", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/6/6d/SC_Freiburg_logo.svg/330px-SC_Freiburg_logo.svg.png" },
      { name: "Heidenheim", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/1._FC_Heidenheim_1846.svg/330px-1._FC_Heidenheim_1846.svg.png" },
      { name: "Hoffenheim", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Logo_TSG_Hoffenheim.svg/330px-Logo_TSG_Hoffenheim.svg.png" },
      { name: "Holstein Kiel", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Holstein_Kiel_Logo.svg/330px-Holstein_Kiel_Logo.svg.png" },
      { name: "Leverkusen", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/5/59/Bayer_04_Leverkusen_logo.svg/330px-Bayer_04_Leverkusen_logo.svg.png" },
      { name: "Mainz 05", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/1._FSV_Mainz_05_logo.svg/330px-1._FSV_Mainz_05_logo.svg.png" },
      { name: "Mönchengladbach", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Borussia_M%C3%B6nchengladbach_logo.svg/330px-Borussia_M%C3%B6nchengladbach_logo.svg.png" },
      { name: "RB Leipzig", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/0/04/RB_Leipzig_2014_logo.svg/330px-RB_Leipzig_2014_logo.svg.png" },
      { name: "St. Pauli", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/8/8f/FC_St._Pauli_logo_%282018%29.svg/330px-FC_St._Pauli_logo_%282018%29.svg.png" },
      { name: "Stuttgart", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/VfB_Stuttgart_1893_Logo.svg/330px-VfB_Stuttgart_1893_Logo.svg.png" },
      { name: "Union Berlin", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/1._FC_Union_Berlin_Logo.svg/330px-1._FC_Union_Berlin_Logo.svg.png" },
      { name: "Werder Brême", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/SV-Werder-Bremen-Logo.svg/330px-SV-Werder-Bremen-Logo.svg.png" },
      { name: "Wolfsburg", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/VfL_Wolfsburg_logo_2026.svg/330px-VfL_Wolfsburg_logo_2026.svg.png" },
    ],
  },
  {
    id: "serie-a",
    name: "Serie A",
    country: "Italie",
    clubs: [
      { name: "Atalanta", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/f/f2/Atalanta_BC_new_logo.svg/330px-Atalanta_BC_new_logo.svg.png" },
      { name: "Bologne", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Bologna_F.C._1909_logo.svg/330px-Bologna_F.C._1909_logo.svg.png" },
      { name: "Cagliari", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/6/61/Cagliari_Calcio_1920.svg/330px-Cagliari_Calcio_1920.svg.png" },
      { name: "Côme", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Calcio_Como_-_logo_%28Italy%2C_2019-%29.svg/330px-Calcio_Como_-_logo_%28Italy%2C_2019-%29.svg.png" },
      { name: "Empoli", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/f/fb/Empoli_FC_crest.svg/330px-Empoli_FC_crest.svg.png" },
      { name: "Fiorentina", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/ACF_Fiorentina_-_logo_%28Italy%2C_2022%29.svg/330px-ACF_Fiorentina_-_logo_%28Italy%2C_2022%29.svg.png" },
      { name: "Genoa", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/2/2c/Genoa_CFC_crest.svg/330px-Genoa_CFC_crest.svg.png" },
      { name: "Hellas Vérone", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/9/92/Hellas_Verona_FC_logo_%282020%29.svg/330px-Hellas_Verona_FC_logo_%282020%29.svg.png" },
      { name: "Inter Milan", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/FC_Internazionale_Milano_2021.svg/330px-FC_Internazionale_Milano_2021.svg.png" },
      { name: "Juventus", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ed/Juventus_FC_-_logo_black_%28Italy%2C_2020%29.svg/330px-Juventus_FC_-_logo_black_%28Italy%2C_2020%29.svg.png" },
      { name: "Latium", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/c/ce/S.S._Lazio_badge.svg/330px-S.S._Lazio_badge.svg.png" },
      { name: "Lecce", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/2/23/US_Lecce_crest.svg/330px-US_Lecce_crest.svg.png" },
      { name: "AC Milan", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Logo_of_AC_Milan.svg/330px-Logo_of_AC_Milan.svg.png" },
      { name: "Monza", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/a/a7/AC_Monza_logo_%282021%29.svg/330px-AC_Monza_logo_%282021%29.svg.png" },
      { name: "Naples", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/SSC_Napoli_2025_%28white_and_azure%29.svg/330px-SSC_Napoli_2025_%28white_and_azure%29.svg.png" },
      { name: "Parme", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/Logo_Parma_Calcio_1913_%28adozione_2016%29.svg/330px-Logo_Parma_Calcio_1913_%28adozione_2016%29.svg.png" },
      { name: "AS Rome", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/f/f7/AS_Roma_logo_%282017%29.svg/330px-AS_Roma_logo_%282017%29.svg.png" },
      { name: "Turin", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/2/2e/Torino_FC_Logo.svg/330px-Torino_FC_Logo.svg.png" },
      { name: "Udinese", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/c/ce/Udinese_Calcio_logo.svg/330px-Udinese_Calcio_logo.svg.png" },
      { name: "Venise", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/3/39/Venezia_FC_crest.svg/330px-Venezia_FC_crest.svg.png" },
    ],
  },
  {
    id: "europa",
    name: "Ligue des Champions · Europe",
    country: "Europe",
    clubs: [
      { name: "Paris SG", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/a/a7/Paris_Saint-Germain_F.C..svg/330px-Paris_Saint-Germain_F.C..svg.png" },
      { name: "Manchester City", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/e/eb/Manchester_City_FC_badge.svg/330px-Manchester_City_FC_badge.svg.png" },
      { name: "Real Madrid", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/5/56/Real_Madrid_CF.svg/330px-Real_Madrid_CF.svg.png" },
      { name: "Bayern Munich", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/FC_Bayern_M%C3%BCnchen_logo_%282024%29.svg/330px-FC_Bayern_M%C3%BCnchen_logo_%282024%29.svg.png" },
      { name: "Liverpool", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/0/0c/Liverpool_FC.svg/330px-Liverpool_FC.svg.png" },
      { name: "Arsenal", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/5/53/Arsenal_FC.svg/330px-Arsenal_FC.svg.png" },
      { name: "Inter Milan", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/FC_Internazionale_Milano_2021.svg/330px-FC_Internazionale_Milano_2021.svg.png" },
      { name: "FC Barcelone", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/4/47/FC_Barcelona_%28crest%29.svg/330px-FC_Barcelona_%28crest%29.svg.png" },
      { name: "Marseille", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Olympique_de_Marseille_2026_logo.svg/330px-Olympique_de_Marseille_2026_logo.svg.png" },
      { name: "Toulouse", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/6/63/Toulouse_FC_2018_logo.svg/330px-Toulouse_FC_2018_logo.svg.png" },
    ],
  },
];

const LEAGUE_BY_NAME = new Map<string, LeagueDef>();
for (const league of LEAGUES) {
  LEAGUE_BY_NAME.set(league.name.toLowerCase(), league);
}

/** Résout une ligue par son nom saisi (normalisé) ou null. */
export function findLeague(name: string): LeagueDef | null {
  const key = name.trim().toLowerCase();
  return LEAGUE_BY_NAME.get(key) ?? null;
}

/** Logo d'un club dans une ligue donnée (null si inconnu). */
export function clubLogo(league: LeagueDef, clubName: string): string | null {
  return league.clubs.find((c) => c.name === clubName)?.logo ?? null;
}

