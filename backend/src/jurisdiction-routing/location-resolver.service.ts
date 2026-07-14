import { Injectable, Logger } from '@nestjs/common';
import { LocationRegistry } from '../localization/localization.constants';
import { MatchType } from './jurisdiction-routing.types';
import { LOCATION_ALIASES } from './jurisdiction-routing.constants';

@Injectable()
export class LocationResolverService {
  private readonly logger = new Logger(LocationResolverService.name);

  // Levenshtein distance for fuzzy matching
  private getLevenshteinDistance(a: string, b: string): number {
    const tmp: number[][] = [];
    let i, j;
    for (i = 0; i <= a.length; i++) {
      tmp[i] = [i];
    }
    for (j = 0; j <= b.length; j++) {
      tmp[0][j] = j;
    }
    for (i = 1; i <= a.length; i++) {
      for (j = 1; j <= b.length; j++) {
        tmp[i][j] = Math.min(
          tmp[i - 1][j] + 1,
          tmp[i][j - 1] + 1,
          tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return tmp[a.length][b.length];
  }

  private getSimilarity(a: string, b: string): number {
    const distance = this.getLevenshteinDistance(a, b);
    const maxLength = Math.max(a.length, b.length);
    if (maxLength === 0) return 1.0;
    return 1.0 - distance / maxLength;
  }

  // Normalize location strings
  public normalize(text: string): string {
    if (!text) return '';
    // Strip punctuation and noise words, convert to lowercase, normalize extra whitespace
    return text
      .toLowerCase()
      .replace(/[।?!.,\-\/\\\(\)]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  public resolve(input: string): {
    districtCode: string;
    cityCode?: string;
    localityCode?: string;
    confidence: number;
    matchType: MatchType;
  } {
    const rawNormalized = this.normalize(input);
    if (!rawNormalized) {
      return {
        districtCode: 'LUCKNOW', // Default fallback
        confidence: 0.0,
        matchType: MatchType.NONE,
      };
    }

    // Split input into parts if comma or space separated (e.g., "banki, barabanki")
    const tokens = rawNormalized.split(/\s+/).map(t => t.trim()).filter(Boolean);

    // Look for exact district / state matching in token list first
    let matchedDistrict: any = null;
    let districtMatchType = MatchType.NONE;
    let districtConfidence = 0.0;

    // 1. Alias Match for district
    for (const token of tokens) {
      const alias = LOCATION_ALIASES[token];
      if (alias) {
        const found = LocationRegistry.find(
          item => item.type === 'DISTRICT' && item.code.toUpperCase() === alias.toUpperCase()
        );
        if (found) {
          matchedDistrict = found;
          districtMatchType = MatchType.ALIAS;
          districtConfidence = 0.95;
          break;
        }
      }
    }

    // 2. Exact Match for district
    if (!matchedDistrict) {
      for (const token of tokens) {
        const found = LocationRegistry.find(
          item =>
            item.type === 'DISTRICT' &&
            (item.code.toLowerCase() === token ||
              item.en.toLowerCase() === token ||
              item.hi.toLowerCase() === token ||
              item.hinglish.toLowerCase() === token)
        );
        if (found) {
          matchedDistrict = found;
          districtMatchType = MatchType.EXACT;
          districtConfidence = 1.0;
          break;
        }
      }
    }

    // 3. Exact Match for multi-word district (e.g., "gautam buddha nagar")
    if (!matchedDistrict) {
      const found = LocationRegistry.find(
        item =>
          item.type === 'DISTRICT' &&
          (item.en.toLowerCase() === rawNormalized ||
            item.hi.toLowerCase() === rawNormalized ||
            item.hinglish.toLowerCase() === rawNormalized)
      );
      if (found) {
        matchedDistrict = found;
        districtMatchType = MatchType.EXACT;
        districtConfidence = 1.0;
      }
    }

    // 4. Fuzzy Match for district
    if (!matchedDistrict) {
      let highestSimilarity = 0.0;
      let fuzzyBest: any = null;

      for (const item of LocationRegistry.filter(entry => entry.type === 'DISTRICT')) {
        for (const token of tokens) {
          const simEn = this.getSimilarity(token, item.en.toLowerCase());
          const simHi = this.getSimilarity(token, item.hi.toLowerCase());
          const simHing = this.getSimilarity(token, item.hinglish.toLowerCase());
          const maxSim = Math.max(simEn, simHi, simHing);

          if (maxSim > highestSimilarity) {
            highestSimilarity = maxSim;
            fuzzyBest = item;
          }
        }
      }

      if (highestSimilarity >= 0.75) {
        matchedDistrict = fuzzyBest;
        districtMatchType = MatchType.FUZZY;
        districtConfidence = Math.round(highestSimilarity * 100) / 100;
      }
    }

    // Default matching fallback if district cannot be resolved
    const finalDistrictCode = matchedDistrict ? matchedDistrict.code : 'LUCKNOW';
    const finalMatchType = matchedDistrict ? districtMatchType : MatchType.NONE;
    const finalConfidence = matchedDistrict ? districtConfidence : 0.5;

    // Extract locality and city based on tokens or aliases
    let resolvedCity: string | undefined = undefined;
    let resolvedLocality: string | undefined = undefined;

    // Check tokens for locality/city match
    for (const token of tokens) {
      const normalizedToken = token.toUpperCase();
      // Simple alias mapping check for cities (e.g., bnki -> BANKI)
      const alias = LOCATION_ALIASES[token];
      if (alias) {
        resolvedCity = alias;
        resolvedLocality = alias;
      } else if (
        normalizedToken !== finalDistrictCode &&
        normalizedToken !== 'DISTRICT' &&
        normalizedToken !== 'ZILA' &&
        normalizedToken !== 'CITY' &&
        normalizedToken !== 'AREA'
      ) {
        // Assume non-district token is city/locality
        resolvedCity = normalizedToken;
        resolvedLocality = normalizedToken;
      }
    }

    // Specific mapping override for sector 62 noida
    if (rawNormalized.includes('sector 62') || rawNormalized.includes('sector62')) {
      resolvedCity = 'NOIDA';
      resolvedLocality = 'SECTOR_62';
    } else if (rawNormalized.includes('gomti nagar') || rawNormalized.includes('gomtinagar')) {
      resolvedCity = 'LUCKNOW';
      resolvedLocality = 'GOMTI_NAGAR';
    } else if (rawNormalized.includes('civil lines') || rawNormalized.includes('civillines')) {
      resolvedCity = 'PRAYAGRAJ';
      resolvedLocality = 'CIVIL_LINES';
    } else if (rawNormalized.includes('indirapuram')) {
      resolvedCity = 'GHAZIABAD';
      resolvedLocality = 'INDIRAPURAM';
    } else if (rawNormalized.includes('phoenix mall') || rawNormalized.includes('phoenix palassio') || rawNormalized.includes('phoenix')) {
      resolvedCity = 'LUCKNOW';
      resolvedLocality = 'PHOENIX_MALL';
    } else if (rawNormalized.includes('hazratganj')) {
      resolvedCity = 'LUCKNOW';
      resolvedLocality = 'HAZRATGANJ';
    } else if (rawNormalized.includes('aliganj')) {
      resolvedCity = 'LUCKNOW';
      resolvedLocality = 'ALIGANJ';
    } else if (rawNormalized.includes('charbagh')) {
      resolvedCity = 'LUCKNOW';
      resolvedLocality = 'CHARBAGH';
    } else if (rawNormalized.includes('indira nagar') || rawNormalized.includes('indiranagar')) {
      resolvedCity = 'LUCKNOW';
      resolvedLocality = 'INDIRA_NAGAR';
    } else if (rawNormalized.includes('kalyanpur')) {
      resolvedCity = 'KANPUR';
      resolvedLocality = 'KALYANPUR';
    } else if (rawNormalized.includes('cantonment')) {
      resolvedCity = 'VARANASI';
      resolvedLocality = 'CANTONMENT';
    } else if (rawNormalized.includes('banki')) {
      resolvedCity = 'BANKI';
      resolvedLocality = 'BANKI';
    }

    let districtCode = finalDistrictCode;
    let confidence = finalConfidence;
    let matchType = finalMatchType;

    // Explicit override if district is Lucknow but city/locality points elsewhere
    if (districtCode === 'LUCKNOW') {
      if (resolvedCity === 'NOIDA') {
        districtCode = 'GAUTAM_BUDDHA_NAGAR';
      } else if (resolvedCity === 'BANKI') {
        districtCode = 'BARABANKI';
      } else if (resolvedCity === 'PRAYAGRAJ' || resolvedCity === 'ALLAHABAD') {
        districtCode = 'PRAYAGRAJ';
      } else if (resolvedCity === 'VARANASI' || resolvedCity === 'BENARES') {
        districtCode = 'VARANASI';
      } else if (resolvedCity === 'KANPUR') {
        districtCode = 'KANPUR_NAGAR';
      } else if (resolvedCity === 'GHAZIABAD') {
        districtCode = 'GHAZIABAD';
      }
    }

    return {
      districtCode,
      cityCode: resolvedCity,
      localityCode: resolvedLocality,
      confidence,
      matchType,
    };
  }
}
