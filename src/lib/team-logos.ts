/**
 * Catalogue unifié et normalisé des blasons officiels de clubs (saisons 2024–2027).
 *
 * Résout aussi bien les noms français utilisés dans l'application (« FC Barcelone »,
 * « Athletic Bilbao », « Naples », « AS Rome », « Latium », « Fribourg », « Werder Brême »,
 * « Paris SG »…) que les noms internationaux / anglais / natifs renvoyés par ESPN
 * (« Barcelona », « Athletic Club », « Napoli », « AS Roma », « Lazio », « SC Freiburg »,
 * « Werder Bremen », « Paris Saint-Germain »…).
 *
 * Fournit plusieurs URLs candidates (CDN ESPN 500×500 PNG + CDN API-Sports PNG + URL base de
 * données éventuelle) afin que `<TeamAvatar>` bascule automatiquement en cas d'indisponibilité
 * d'un CDN.
 */

interface ClubLogoDef {
  names: string[];
  espnId?: number;
  apiSportsId?: number;
}

const ESPN_CDN = (id: number) =>
  `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`;

const API_SPORTS_CDN = (id: number) =>
  `https://media.api-sports.io/football/teams/${id}.png`;

const CLUB_CATALOG: ClubLogoDef[] = [
  // ======================== LIGUE 1 & FRANCE ========================
  {
    names: ["Paris SG", "Paris Saint-Germain", "PSG", "Paris Saint Germain"],
    espnId: 160,
    apiSportsId: 85,
  },
  {
    names: ["Paris FC", "PFC"],
    espnId: 6851,
    apiSportsId: 114,
  },
  {
    names: ["Marseille", "Olympique de Marseille", "OM", "Olympique Marseille"],
    espnId: 176,
    apiSportsId: 81,
  },
  {
    names: ["Lyon", "Olympique Lyonnais", "OL"],
    espnId: 167,
    apiSportsId: 80,
  },
  {
    names: ["Monaco", "AS Monaco"],
    espnId: 174,
    apiSportsId: 91,
  },
  {
    names: ["Lille", "LOSC", "LOSC Lille", "Lille OSC"],
    espnId: 166,
    apiSportsId: 79,
  },
  {
    names: ["Nice", "OGC Nice"],
    espnId: 2502,
    apiSportsId: 84,
  },
  {
    names: ["Lens", "RC Lens", "Racing Club de Lens"],
    espnId: 175,
    apiSportsId: 116,
  },
  {
    names: ["Rennes", "Stade Rennais", "Stade Rennais FC"],
    espnId: 169,
    apiSportsId: 94,
  },
  {
    names: ["Brest", "Stade Brestois", "Stade Brestois 29"],
    espnId: 6997,
    apiSportsId: 106,
  },
  {
    names: ["Strasbourg", "RC Strasbourg", "RC Strasbourg Alsace", "Strasbourg Alsace"],
    espnId: 180,
    apiSportsId: 95,
  },
  {
    names: ["Toulouse", "Toulouse FC", "TFC"],
    espnId: 179,
    apiSportsId: 96,
  },
  {
    names: ["Lorient", "FC Lorient"],
    espnId: 273,
    apiSportsId: 97,
  },
  {
    names: ["Auxerre", "AJ Auxerre"],
    espnId: 172,
    apiSportsId: 108,
  },
  {
    names: ["Angers", "Angers SCO"],
    espnId: 7868,
    apiSportsId: 77,
  },
  {
    names: ["Le Havre", "Le Havre AC", "HAC"],
    espnId: 3236,
    apiSportsId: 111,
  },
  {
    names: ["Le Mans", "Le Mans FC"],
    espnId: 2697,
    apiSportsId: 1300,
  },
  {
    names: ["Troyes", "ESTAC Troyes", "ESTAC"],
    espnId: 170,
    apiSportsId: 110,
  },
  {
    names: ["Reims", "Stade de Reims"],
    espnId: 3243,
    apiSportsId: 93,
  },
  {
    names: ["Nantes", "FC Nantes"],
    espnId: 165,
    apiSportsId: 83,
  },
  {
    names: ["Montpellier", "Montpellier HSC", "MHSC"],
    espnId: 274,
    apiSportsId: 82,
  },
  {
    names: ["Saint-Étienne", "AS Saint-Étienne", "Saint-Etienne", "AS Saint-Etienne", "ASSE"],
    espnId: 178,
    apiSportsId: 1063,
  },
  {
    names: ["Metz", "FC Metz"],
    espnId: 177,
    apiSportsId: 112,
  },
  {
    names: ["Clermont", "Clermont Foot", "Clermont Foot 63"],
    espnId: 3231,
    apiSportsId: 99,
  },
  {
    names: ["Bordeaux", "Girondins de Bordeaux"],
    espnId: 159,
    apiSportsId: 78,
  },
  {
    names: ["Bastia", "SC Bastia"],
    espnId: 2501,
    apiSportsId: 1305,
  },
  {
    names: ["Guingamp", "EA Guingamp"],
    espnId: 171,
    apiSportsId: 90,
  },
  {
    names: ["Caen", "SM Caen"],
    espnId: 2929,
    apiSportsId: 88,
  },

  // ======================== PREMIER LEAGUE & ANGLETERRE ========================
  {
    names: ["Manchester City", "Man City", "Man. City"],
    espnId: 382,
    apiSportsId: 50,
  },
  {
    names: ["Arsenal", "Arsenal FC"],
    espnId: 359,
    apiSportsId: 42,
  },
  {
    names: ["Liverpool", "Liverpool FC"],
    espnId: 364,
    apiSportsId: 40,
  },
  {
    names: ["Chelsea", "Chelsea FC"],
    espnId: 363,
    apiSportsId: 49,
  },
  {
    names: ["Manchester United", "Man United", "Man Utd", "Man. United"],
    espnId: 360,
    apiSportsId: 33,
  },
  {
    names: ["Tottenham", "Tottenham Hotspur", "Spurs"],
    espnId: 367,
    apiSportsId: 47,
  },
  {
    names: ["Newcastle", "Newcastle United", "Newcastle Utd"],
    espnId: 361,
    apiSportsId: 34,
  },
  {
    names: ["Aston Villa"],
    espnId: 362,
    apiSportsId: 66,
  },
  {
    names: ["Brighton", "Brighton & Hove Albion", "Brighton and Hove Albion"],
    espnId: 331,
    apiSportsId: 51,
  },
  {
    names: ["Bournemouth", "AFC Bournemouth"],
    espnId: 349,
    apiSportsId: 35,
  },
  {
    names: ["Brentford", "Brentford FC"],
    espnId: 337,
    apiSportsId: 55,
  },
  {
    names: ["Fulham", "Fulham FC"],
    espnId: 370,
    apiSportsId: 36,
  },
  {
    names: ["Crystal Palace", "C Palace"],
    espnId: 384,
    apiSportsId: 52,
  },
  {
    names: ["Everton", "Everton FC"],
    espnId: 368,
    apiSportsId: 45,
  },
  {
    names: ["Nottingham Forest", "Nottm Forest", "Nott'm Forest", "Nottingham"],
    espnId: 393,
    apiSportsId: 65,
  },
  {
    names: ["Leeds United", "Leeds"],
    espnId: 357,
    apiSportsId: 63,
  },
  {
    names: ["Sunderland", "Sunderland AFC"],
    espnId: 366,
    apiSportsId: 746,
  },
  {
    names: ["Ipswich Town", "Ipswich"],
    espnId: 373,
    apiSportsId: 57,
  },
  {
    names: ["Hull City", "Hull"],
    espnId: 306,
    apiSportsId: 64,
  },
  {
    names: ["Coventry City", "Coventry"],
    espnId: 388,
    apiSportsId: 1346,
  },
  {
    names: ["West Ham", "West Ham United", "West Ham Utd"],
    espnId: 371,
    apiSportsId: 48,
  },
  {
    names: ["Wolverhampton", "Wolverhampton Wanderers", "Wolves"],
    espnId: 380,
    apiSportsId: 39,
  },
  {
    names: ["Leicester City", "Leicester"],
    espnId: 375,
    apiSportsId: 46,
  },
  {
    names: ["Southampton", "Southampton FC"],
    espnId: 376,
    apiSportsId: 41,
  },
  {
    names: ["Burnley", "Burnley FC"],
    espnId: 379,
    apiSportsId: 44,
  },
  {
    names: ["Sheffield United", "Sheffield Utd"],
    espnId: 398,
    apiSportsId: 62,
  },
  {
    names: ["Luton Town", "Luton"],
    espnId: 301,
    apiSportsId: 1359,
  },
  {
    names: ["Middlesbrough", "Boro"],
    espnId: 369,
    apiSportsId: 70,
  },
  {
    names: ["Norwich City", "Norwich"],
    espnId: 381,
    apiSportsId: 71,
  },
  {
    names: ["West Bromwich Albion", "West Brom", "WBA"],
    espnId: 383,
    apiSportsId: 60,
  },
  {
    names: ["Watford", "Watford FC"],
    espnId: 395,
    apiSportsId: 38,
  },

  // ======================== LALIGA & ESPAGNE ========================
  {
    names: ["Real Madrid", "Real Madrid CF"],
    espnId: 86,
    apiSportsId: 541,
  },
  {
    names: ["FC Barcelone", "Barcelona", "FC Barcelona", "Barcelone", "Barça", "Barca"],
    espnId: 83,
    apiSportsId: 529,
  },
  {
    names: ["Atlético Madrid", "Atletico Madrid", "Atlético de Madrid", "Atletico de Madrid", "Atlético"],
    espnId: 1068,
    apiSportsId: 530,
  },
  {
    names: ["Athletic Bilbao", "Athletic Club", "Athletic", "Athletic Club Bilbao"],
    espnId: 93,
    apiSportsId: 531,
  },
  {
    names: ["Real Sociedad"],
    espnId: 89,
    apiSportsId: 548,
  },
  {
    names: ["Villarreal", "Villarreal CF"],
    espnId: 102,
    apiSportsId: 533,
  },
  {
    names: ["Real Betis", "Betis", "Real Betis Balompié", "Betis Séville"],
    espnId: 244,
    apiSportsId: 543,
  },
  {
    names: ["FC Séville", "Sevilla", "Sevilla FC", "Séville"],
    espnId: 243,
    apiSportsId: 536,
  },
  {
    names: ["Valence", "Valencia", "Valencia CF"],
    espnId: 94,
    apiSportsId: 532,
  },
  {
    names: ["Celta Vigo", "RC Celta", "Celta de Vigo", "RC Celta de Vigo", "Celta"],
    espnId: 85,
    apiSportsId: 538,
  },
  {
    names: ["CA Osasuna", "Osasuna"],
    espnId: 97,
    apiSportsId: 727,
  },
  {
    names: ["Getafe", "Getafe CF"],
    espnId: 2922,
    apiSportsId: 546,
  },
  {
    names: ["Rayo Vallecano", "Rayo"],
    espnId: 101,
    apiSportsId: 728,
  },
  {
    names: ["Alavés", "Deportivo Alavés", "Alaves", "Deportivo Alaves"],
    espnId: 96,
    apiSportsId: 542,
  },
  {
    names: ["Espanyol", "RCD Espanyol", "Espanyol Barcelone", "Espanyol Barcelona"],
    espnId: 88,
    apiSportsId: 540,
  },
  {
    names: ["Levante", "Levante UD"],
    espnId: 1538,
    apiSportsId: 539,
  },
  {
    names: ["Elche", "Elche CF"],
    espnId: 3751,
    apiSportsId: 797,
  },
  {
    names: ["Racing Santander", "Real Racing Club", "Racing de Santander"],
    espnId: 87,
    apiSportsId: 4665,
  },
  {
    names: ["Deportivo", "Deportivo La Coruña", "Deportivo La Corogne", "RC Deportivo"],
    espnId: 90,
    apiSportsId: 544,
  },
  {
    names: ["Málaga", "Malaga", "Málaga CF", "Malaga CF"],
    espnId: 99,
    apiSportsId: 535,
  },
  {
    names: ["Gérone", "Girona", "Girona FC"],
    espnId: 9812,
    apiSportsId: 547,
  },
  {
    names: ["RCD Majorque", "Mallorca", "RCD Mallorca", "Majorque"],
    espnId: 84,
    apiSportsId: 798,
  },
  {
    names: ["Las Palmas", "UD Las Palmas"],
    espnId: 98,
    apiSportsId: 534,
  },
  {
    names: ["Leganés", "CD Leganés", "Leganes", "CD Leganes"],
    espnId: 17534,
    apiSportsId: 537,
  },
  {
    names: ["Real Valladolid", "Valladolid", "Real Valladolid CF"],
    espnId: 95,
    apiSportsId: 720,
  },
  {
    names: ["Real Oviedo", "Oviedo"],
    espnId: 92,
    apiSportsId: 718,
  },
  {
    names: ["Cádiz", "Cadiz", "Cadix", "Cádiz CF"],
    espnId: 3842,
    apiSportsId: 724,
  },
  {
    names: ["Granada", "Grenade", "Granada CF"],
    espnId: 3747,
    apiSportsId: 715,
  },
  {
    names: ["Almería", "UD Almería", "Almeria", "UD Almeria"],
    espnId: 6832,
    apiSportsId: 723,
  },

  // ======================== BUNDESLIGA & ALLEMAGNE ========================
  {
    names: ["Bayern Munich", "Bayern München", "FC Bayern Munich", "FC Bayern München", "Bayern"],
    espnId: 132,
    apiSportsId: 157,
  },
  {
    names: ["Dortmund", "Borussia Dortmund", "BVB"],
    espnId: 124,
    apiSportsId: 165,
  },
  {
    names: ["Leverkusen", "Bayer Leverkusen", "Bayer 04 Leverkusen"],
    espnId: 131,
    apiSportsId: 168,
  },
  {
    names: ["RB Leipzig", "Leipzig", "RasenBallsport Leipzig"],
    espnId: 11420,
    apiSportsId: 173,
  },
  {
    names: ["Stuttgart", "VfB Stuttgart"],
    espnId: 134,
    apiSportsId: 172,
  },
  {
    names: ["Eintracht Francfort", "Eintracht Frankfurt", "Frankfurt", "Francfort"],
    espnId: 125,
    apiSportsId: 169,
  },
  {
    names: ["Fribourg", "SC Freiburg", "Freiburg"],
    espnId: 126,
    apiSportsId: 160,
  },
  {
    names: ["Werder Brême", "Werder Bremen", "SV Werder Bremen", "Bremen"],
    espnId: 137,
    apiSportsId: 162,
  },
  {
    names: ["Mainz 05", "Mainz", "1. FSV Mainz 05", "FSV Mainz 05", "Mayence"],
    espnId: 2950,
    apiSportsId: 164,
  },
  {
    names: ["Augsbourg", "FC Augsburg", "Augsburg"],
    espnId: 3841,
    apiSportsId: 170,
  },
  {
    names: ["Hoffenheim", "TSG Hoffenheim", "TSG 1899 Hoffenheim", "1899 Hoffenheim"],
    espnId: 7911,
    apiSportsId: 167,
  },
  {
    names: ["Union Berlin", "1. FC Union Berlin", "FC Union Berlin"],
    espnId: 598,
    apiSportsId: 182,
  },
  {
    names: [
      "Mönchengladbach",
      "Borussia Mönchengladbach",
      "Borussia Monchengladbach",
      "Monchengladbach",
      "Gladbach",
      "M'gladbach",
    ],
    espnId: 268,
    apiSportsId: 163,
  },
  {
    names: ["Hamburg SV", "Hamburger SV", "Hambourg", "Hamburg", "HSV"],
    espnId: 127,
    apiSportsId: 175,
  },
  {
    names: ["FC Cologne", "1. FC Köln", "1. FC Koln", "Cologne", "Köln", "FC Köln"],
    espnId: 122,
    apiSportsId: 192,
  },
  {
    names: ["Schalke 04", "FC Schalke 04", "Schalke"],
    espnId: 133,
    apiSportsId: 174,
  },
  {
    names: ["SC Paderborn 07", "Paderborn", "SC Paderborn"],
    espnId: 3307,
    apiSportsId: 185,
  },
  {
    names: ["SV Elversberg", "Elversberg"],
    espnId: 10388,
    apiSportsId: 1660,
  },
  {
    names: ["Wolfsburg", "VfL Wolfsburg", "Wolfsbourg"],
    espnId: 138,
    apiSportsId: 161,
  },
  {
    names: ["Heidenheim", "1. FC Heidenheim", "1. FC Heidenheim 1846", "FC Heidenheim"],
    espnId: 6418,
    apiSportsId: 180,
  },
  {
    names: ["St. Pauli", "FC St. Pauli", "Saint-Pauli", "St Pauli"],
    espnId: 270,
    apiSportsId: 186,
  },
  {
    names: ["Bochum", "VfL Bochum", "VfL Bochum 1848"],
    espnId: 121,
    apiSportsId: 176,
  },
  {
    names: ["Holstein Kiel", "Kiel"],
    espnId: 7884,
    apiSportsId: 191,
  },
  {
    names: ["Hertha Berlin", "Hertha BSC", "Hertha"],
    espnId: 129,
    apiSportsId: 159,
  },
  {
    names: ["Darmstadt", "SV Darmstadt 98", "Darmstadt 98"],
    espnId: 3812,
    apiSportsId: 181,
  },

  // ======================== SERIE A & ITALIE ========================
  {
    names: ["Inter Milan", "Internazionale", "FC Internazionale", "Inter"],
    espnId: 110,
    apiSportsId: 505,
  },
  {
    names: ["AC Milan", "Milan"],
    espnId: 103,
    apiSportsId: 489,
  },
  {
    names: ["Juventus", "Juventus FC", "Juventus Turin"],
    espnId: 111,
    apiSportsId: 496,
  },
  {
    names: ["Naples", "Napoli", "SSC Napoli"],
    espnId: 114,
    apiSportsId: 492,
  },
  {
    names: ["AS Rome", "AS Roma", "Roma"],
    espnId: 104,
    apiSportsId: 497,
  },
  {
    names: ["Latium", "Lazio", "SS Lazio", "Lazio Rome"],
    espnId: 112,
    apiSportsId: 487,
  },
  {
    names: ["Atalanta", "Atalanta BC", "Atalanta Bergame"],
    espnId: 105,
    apiSportsId: 499,
  },
  {
    names: ["Fiorentina", "ACF Fiorentina"],
    espnId: 109,
    apiSportsId: 502,
  },
  {
    names: ["Bologne", "Bologna", "Bologna FC", "Bologna FC 1909"],
    espnId: 107,
    apiSportsId: 500,
  },
  {
    names: ["Turin", "Torino", "Torino FC"],
    espnId: 239,
    apiSportsId: 503,
  },
  {
    names: ["Côme", "Como", "Como 1907"],
    espnId: 2572,
    apiSportsId: 895,
  },
  {
    names: ["Udinese", "Udinese Calcio"],
    espnId: 118,
    apiSportsId: 494,
  },
  {
    names: ["Genoa", "Genoa CFC"],
    espnId: 3263,
    apiSportsId: 495,
  },
  {
    names: ["Cagliari", "Cagliari Calcio"],
    espnId: 2925,
    apiSportsId: 490,
  },
  {
    names: ["Lecce", "US Lecce"],
    espnId: 113,
    apiSportsId: 867,
  },
  {
    names: ["Monza", "AC Monza"],
    espnId: 4007,
    apiSportsId: 1579,
  },
  {
    names: ["Parme", "Parma", "Parma Calcio", "Parma Calcio 1913"],
    espnId: 115,
    apiSportsId: 523,
  },
  {
    names: ["Venise", "Venezia", "Venezia FC"],
    espnId: 17530,
    apiSportsId: 517,
  },
  {
    names: ["Sassuolo", "US Sassuolo"],
    espnId: 3997,
    apiSportsId: 488,
  },
  {
    names: ["Frosinone", "Frosinone Calcio"],
    espnId: 4057,
    apiSportsId: 512,
  },
  {
    names: ["Empoli", "Empoli FC"],
    espnId: 2574,
    apiSportsId: 511,
  },
  {
    names: ["Hellas Vérone", "Hellas Verona", "Verona", "Vérone"],
    espnId: 119,
    apiSportsId: 504,
  },
  {
    names: ["Cremonese", "US Cremonese"],
    espnId: 4050,
    apiSportsId: 520,
  },
  {
    names: ["Pisa", "Pisa SC", "Pise"],
    espnId: 3956,
    apiSportsId: 862,
  },
  {
    names: ["Salernitana", "US Salernitana"],
    espnId: 3240,
    apiSportsId: 514,
  },
  {
    names: ["Sampdoria", "UC Sampdoria"],
    espnId: 2734,
    apiSportsId: 498,
  },
  {
    names: ["Spezia", "Spezia Calcio"],
    espnId: 4056,
    apiSportsId: 515,
  },

  // ======================== COUPES D'EUROPE & INTERNATIONAL ========================
  {
    names: ["Sporting CP", "Sporting", "Sporting Portugal", "Sporting Lisbon"],
    espnId: 2250,
    apiSportsId: 228,
  },
  {
    names: ["Benfica", "SL Benfica"],
    espnId: 1929,
    apiSportsId: 211,
  },
  {
    names: ["FC Porto", "Porto"],
    espnId: 437,
    apiSportsId: 212,
  },
  {
    names: ["Braga", "SC Braga", "Sporting Braga"],
    espnId: 2994,
    apiSportsId: 217,
  },
  {
    names: ["Torreense", "SCU Torreense"],
    espnId: 21615,
  },
  {
    names: ["Ajax", "Ajax Amsterdam", "AFC Ajax"],
    espnId: 139,
    apiSportsId: 194,
  },
  {
    names: ["PSV Eindhoven", "PSV"],
    espnId: 148,
    apiSportsId: 197,
  },
  {
    names: ["Feyenoord", "Feyenoord Rotterdam"],
    espnId: 142,
    apiSportsId: 209,
  },
  {
    names: ["AZ Alkmaar", "AZ"],
    espnId: 140,
    apiSportsId: 201,
  },
  {
    names: ["Twente", "FC Twente"],
    espnId: 152,
    apiSportsId: 415,
  },
  {
    names: ["NEC Nijmegen", "NEC"],
    espnId: 147,
    apiSportsId: 413,
  },
  {
    names: ["Club Brugge", "Club Bruges", "FC Bruges"],
    espnId: 570,
    apiSportsId: 569,
  },
  {
    names: ["Union St.-Gilloise", "Union SG", "Union Saint-Gilloise", "Royale Union Saint-Gilloise"],
    espnId: 5807,
    apiSportsId: 1393,
  },
  {
    names: ["Anderlecht", "RSC Anderlecht"],
    espnId: 441,
    apiSportsId: 554,
  },
  {
    names: ["Galatasaray", "Galatasaray SK"],
    espnId: 432,
    apiSportsId: 645,
  },
  {
    names: ["Fenerbahçe", "Fenerbahce", "Fenerbahçe SK"],
    espnId: 436,
    apiSportsId: 611,
  },
  {
    names: ["Besiktas", "Beşiktaş", "Beşiktaş JK"],
    espnId: 1895,
    apiSportsId: 549,
  },
  {
    names: ["Celtic", "Celtic FC", "Celtic Glasgow"],
    espnId: 256,
    apiSportsId: 247,
  },
  {
    names: ["Rangers", "Rangers FC", "Glasgow Rangers"],
    espnId: 257,
    apiSportsId: 257,
  },
  {
    names: ["Chakhtar Donetsk", "Shakhtar Donetsk", "Shakhtar", "FC Shakhtar Donetsk"],
    espnId: 493,
    apiSportsId: 550,
  },
  {
    names: ["Dynamo Kiev", "Dynamo Kyiv", "FC Dynamo Kyiv"],
    apiSportsId: 572,
  },
  {
    names: ["Slavia Prague", "Slavia Praha", "SK Slavia Praha", "SK Slavia Prague"],
    espnId: 494,
    apiSportsId: 560,
  },
  {
    names: ["Sparta Prague", "Sparta Praha", "AC Sparta Praha", "AC Sparta Prague"],
    espnId: 433,
    apiSportsId: 628,
  },
  {
    names: ["Viktoria Plzen", "Viktoria Plzeň", "FC Viktoria Plzen"],
    espnId: 11706,
    apiSportsId: 567,
  },
  {
    names: ["RB Salzburg", "Red Bull Salzburg", "Salzbourg", "FC Salzburg"],
    espnId: 2790,
    apiSportsId: 571,
  },
  {
    names: ["SK Sturm Graz", "Sturm Graz"],
    espnId: 3746,
    apiSportsId: 637,
  },
  {
    names: ["LASK Linz", "LASK"],
    espnId: 4411,
    apiSportsId: 1026,
  },
  {
    names: ["Dinamo Zagreb", "GNK Dinamo Zagreb"],
    espnId: 597,
    apiSportsId: 620,
  },
  {
    names: ["Étoile Rouge", "Étoile Rouge de Belgrade", "Red Star Belgrade", "Crvena Zvezda", "FK Crvena Zvezda"],
    apiSportsId: 598,
  },
  {
    names: ["Young Boys", "BSC Young Boys", "YB Berne"],
    apiSportsId: 565,
  },
  {
    names: ["FC Bâle", "FC Basel", "Basel"],
    apiSportsId: 551,
  },
  {
    names: ["Olympiacos", "Olympiakos", "Olympiacos Piraeus"],
    espnId: 435,
    apiSportsId: 553,
  },
  {
    names: ["AEK Athens", "AEK Athènes", "AEK"],
    espnId: 887,
    apiSportsId: 575,
  },
  {
    names: ["Panathinaikos", "Panathinaïkos"],
    apiSportsId: 617,
  },
  {
    names: ["PAOK", "PAOK Salonique", "PAOK Thessaloniki"],
    apiSportsId: 619,
  },
  {
    names: ["OFI Crete", "OFI Crète"],
    espnId: 1010,
  },
  {
    names: ["Bodo/Glimt", "Bodø/Glimt", "FK Bodø/Glimt", "Bodo Glimt"],
    espnId: 2980,
    apiSportsId: 327,
  },
  {
    names: ["Viking FK", "Viking"],
    espnId: 510,
    apiSportsId: 329,
  },
  {
    names: ["Lillestrom", "Lillestrøm", "Lillestrøm SK"],
    espnId: 987,
    apiSportsId: 324,
  },
  {
    names: ["FC Copenhague", "FC Copenhagen", "Copenhagen", "FC København"],
    apiSportsId: 400,
  },
  {
    names: ["Midtjylland", "FC Midtjylland"],
    apiSportsId: 397,
  },
  {
    names: ["Malmö FF", "Malmo FF", "Malmö"],
    apiSportsId: 375,
  },
  {
    names: ["Ferencvaros", "Ferencváros", "Ferencvárosi TC"],
    espnId: 622,
    apiSportsId: 651,
  },
  {
    names: ["Slovan Bratislava", "SK Slovan Bratislava", "S Bratislava"],
    espnId: 521,
    apiSportsId: 656,
  },
  {
    names: ["Sabah FK", "Sabah"],
    espnId: 21922,
  },
  {
    names: ["Qarabağ", "Qarabag", "Qarabağ FK"],
    apiSportsId: 556,
  },
  {
    names: ["Omonia Nicosia", "Omonia", "AC Omonia"],
    espnId: 617,
    apiSportsId: 3402,
  },
  {
    names: ["Levski Sofia", "PFC Levski Sofia"],
    espnId: 490,
    apiSportsId: 647,
  },
  {
    names: ["Jagiellonia Bialystok", "Jagiellonia Białystok", "Jagiellonia"],
    espnId: 11505,
    apiSportsId: 336,
  },
  {
    names: ["Lech Poznan", "Lech Poznań", "KKS Lech Poznań"],
    espnId: 2990,
    apiSportsId: 347,
  },
  {
    names: ["Legia Varsovie", "Legia Warsaw", "Legia Warszawa"],
    apiSportsId: 339,
  },
  {
    names: ["NK Celje", "Celje"],
    espnId: 3362,
  },
  {
    names: ["Hapoel Be'er", "Hapoel Be'er Sheva", "Hapoel Beer Sheva"],
    espnId: 13083,
    apiSportsId: 563,
  },
  {
    names: ["Ararat-Armenia", "FC Ararat-Armenia"],
    espnId: 20024,
  },
  {
    names: ["Al-Nassr", "Al Nassr"],
    apiSportsId: 2939,
  },
  {
    names: ["Al-Hilal", "Al Hilal"],
    apiSportsId: 2932,
  },
  {
    names: ["Inter Miami", "Inter Miami CF"],
    apiSportsId: 9568,
  },
];

/** Noms canoniques des clubs disposant déjà d'un blason dans l'application. */
export function virtualClubNames(): string[] {
  const seen = new Set<string>();
  return CLUB_CATALOG.map(club => club.names[0]).filter(name => {
    const key = normalizeTeamKey(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Normalisation sans casse, sans accents et sans ponctuation parasite. */
export function normalizeTeamKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/ł/g, "l")
    .replace(/ß/g, "ss")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LEGAL_AFFIX_TOKENS = new Set([
  "fc",
  "cf",
  "sc",
  "afc",
  "rcd",
  "ogc",
  "losc",
  "aj",
  "vfb",
  "vfl",
  "tsg",
  "fsv",
  "sv",
  "ssc",
  "ud",
  "cd",
  "sd",
  "fk",
  "sk",
  "nk",
  "ac",
  "as",
  "rc",
  "ca",
  "us",
  "ss",
  "sl",
  "1",
]);

/**
 * Clé secondaire allégée des sigles statutaires (« FC », « VfB », « 1. FC », « RCD »…),
 * utilisée uniquement lorsqu'elle désigne un club unique sans ambiguïté (jamais « Paris »,
 * « Milan », « Manchester » ou « Madrid » seuls).
 */
function strippedLegalKey(norm: string): string | null {
  const parts = norm.split(" ").filter((t) => t && !LEGAL_AFFIX_TOKENS.has(t));
  if (parts.length === 0) return null;
  const candidate = parts.join(" ");
  if (
    candidate === "paris" ||
    candidate === "milan" ||
    candidate === "manchester" ||
    candidate === "madrid"
  ) {
    return null;
  }
  return candidate;
}

function urlsForDef(def: ClubLogoDef): string[] {
  const out: string[] = [];
  if (def.espnId != null) out.push(ESPN_CDN(def.espnId));
  if (def.apiSportsId != null) out.push(API_SPORTS_CDN(def.apiSportsId));
  return out;
}

const VIRTUAL_CLUB_BY_ALIAS = new Map<string, ClubLogoDef>();
for (const def of CLUB_CATALOG) {
  for (const alias of def.names) {
    const key = normalizeTeamKey(alias);
    if (key && !VIRTUAL_CLUB_BY_ALIAS.has(key)) VIRTUAL_CLUB_BY_ALIAS.set(key, def);
  }
}
/** Identité canonique afin de reconnaître aussi les variantes PSG / Paris SG, etc. */
export function virtualTeamIdentity(name: string): string {
  const key = normalizeTeamKey(name);
  return normalizeTeamKey(VIRTUAL_CLUB_BY_ALIAS.get(key)?.names[0] ?? name);
}
export function virtualTeamAliases(name: string): string[] {
  const def = VIRTUAL_CLUB_BY_ALIAS.get(normalizeTeamKey(name));
  return def ? [...new Set([name, ...def.names])] : [name];
}

const EXACT_LOGO_MAP = new Map<string, string[]>();
const STRIPPED_LOGO_MAP = new Map<string, string[] | null>();

for (const def of CLUB_CATALOG) {
  const urls = urlsForDef(def);
  if (urls.length === 0) continue;

  for (const alias of def.names) {
    const key = normalizeTeamKey(alias);
    if (!key) continue;
    if (!EXACT_LOGO_MAP.has(key)) {
      EXACT_LOGO_MAP.set(key, urls);
    }

    const stripped = strippedLegalKey(key);
    if (stripped && !EXACT_LOGO_MAP.has(stripped)) {
      const prev = STRIPPED_LOGO_MAP.get(stripped);
      if (prev === undefined) {
        STRIPPED_LOGO_MAP.set(stripped, urls);
      } else if (prev !== null && prev[0] !== urls[0]) {
        // Collision potentielle entre deux clubs distincts -> désactive le repli ambigu
        STRIPPED_LOGO_MAP.set(stripped, null);
      }
    }
  }
}

function isFragileWikimediaUrl(url: string): boolean {
  return /wikimedia\.org/i.test(url);
}

function cleanLogoUrl(url?: string | null): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed || (!trimmed.startsWith("http://") && !trimmed.startsWith("https://") && !trimmed.startsWith("/"))) {
    return null;
  }
  return trimmed;
}

/**
 * Retourne la liste ordonnée et dédoublonnée de toutes les URLs de blason candidates
 * pour un club (CDN ESPN + CDN API-Sports + URL fournie par la base/flux).
 */
export function teamLogoCandidates(
  teamName?: string | null,
  providedLogo?: string | null
): string[] {
  const norm = teamName ? normalizeTeamKey(teamName) : "";
  let catalogUrls: string[] = [];

  if (norm) {
    const exact = EXACT_LOGO_MAP.get(norm);
    if (exact) {
      catalogUrls = exact;
    } else {
      const stripped = strippedLegalKey(norm);
      const fallback = stripped ? STRIPPED_LOGO_MAP.get(stripped) : null;
      if (fallback) {
        catalogUrls = fallback;
      }
    }
  }

  const provided = cleanLogoUrl(providedLogo);
  const ordered: string[] = [];

  const pushUnique = (u: string | null) => {
    if (u && !ordered.includes(u)) ordered.push(u);
  };

  if (provided && !isFragileWikimediaUrl(provided)) {
    // Blason officiel issu d'ESPN ou d'une URL personnalisée fiable : priorité maximale,
    // suivi immédiatement des CDN statiques en secours automatique.
    pushUnique(provided);
    for (const u of catalogUrls) pushUnique(u);
  } else {
    // Pas d'URL fournie (ou ancienne miniature Wikimedia fragile) : priorité aux CDN sportifs
    for (const u of catalogUrls) pushUnique(u);
    if (provided) pushUnique(provided);
  }

  return ordered;
}

/** Retourne l'URL principale du blason d'un club (ou `null` si inconnue). */
export function teamLogo(
  teamName?: string | null,
  fallbackLogo?: string | null
): string | null {
  return teamLogoCandidates(teamName, fallbackLogo)[0] ?? null;
}
