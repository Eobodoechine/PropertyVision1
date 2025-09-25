"use strict";
// Property Data Normalization and Validation
// Fixes inconsistent parsing and conflicting property data
Object.defineProperty(exports, "__esModule", { value: true });
exports.PropertyDataNormalizer = void 0;
class PropertyDataNormalizer {
    constructor() {
        this.seenProperties = new Map();
        this.conflictLog = [];
    }
    /**
     * Generate a property fingerprint for duplicate detection
     */
    generateFingerprint(property) {
        const key = `${property.address?.toLowerCase().trim()}|${property.price}|${property.sqft}`;
        return key;
    }
    /**
     * Validate individual property fields
     */
    validateProperty(property) {
        const flags = [];
        // Address validation
        if (!property.address || property.address.trim().length < 10) {
            flags.push('invalid_address');
        }
        // Price validation
        if (!property.price || property.price < 50000 || property.price > 5000000) {
            flags.push('invalid_price');
        }
        // Square footage validation
        if (!property.sqft || property.sqft < 500 || property.sqft > 10000) {
            flags.push('invalid_sqft');
        }
        // Beds validation
        if (!property.beds || property.beds < 1 || property.beds > 10) {
            flags.push('invalid_beds');
        }
        // Baths validation
        if (!property.baths || property.baths < 1 || property.baths > 8) {
            flags.push('invalid_baths');
        }
        // Year built validation
        if (property.yearBuilt && (property.yearBuilt < 1800 || property.yearBuilt > new Date().getFullYear())) {
            flags.push('invalid_year');
        }
        // PPSF validation (if we have price and sqft)
        if (property.price && property.sqft) {
            const ppsf = property.price / property.sqft;
            if (ppsf < 50 || ppsf > 1000) {
                flags.push('invalid_ppsf');
            }
        }
        return {
            isValid: flags.length === 0,
            flags
        };
    }
    /**
     * Determine confidence level based on validation and source
     */
    calculateConfidence(property, validationFlags) {
        if (validationFlags.length === 0) {
            // High confidence: all fields valid
            if (property.source?.includes('MLS') || property.source?.includes('verified')) {
                return 'high';
            }
            return 'medium';
        }
        else if (validationFlags.length <= 2) {
            // Medium confidence: minor issues
            return 'medium';
        }
        else {
            // Low confidence: multiple issues
            return 'low';
        }
    }
    /**
     * Resolve conflicts between multiple instances of the same property
     */
    resolveConflicts(address, properties) {
        const conflicts = [];
        const merged = {
            address: address,
            fingerprint: '',
            confidence: 'medium',
            validationFlags: [],
            primarySource: 'merged',
            source: 'merged'
        };
        // Fields to check for conflicts
        const fieldsToCheck = ['price', 'sqft', 'beds', 'baths', 'yearBuilt'];
        for (const field of fieldsToCheck) {
            const values = properties.map(p => p[field]).filter(v => v != null);
            const uniqueValues = [...new Set(values)];
            if (uniqueValues.length > 1) {
                // Conflict detected
                const sources = properties.map(p => p.source || 'unknown');
                let resolution;
                let reason;
                if (field === 'sqft' || field === 'price') {
                    // For critical fields, use most common value or median
                    const valueCounts = values.reduce((acc, val) => {
                        acc[val] = (acc[val] || 0) + 1;
                        return acc;
                    }, {});
                    const mostCommon = Object.entries(valueCounts)
                        .sort(([, a], [, b]) => b - a)[0][0];
                    resolution = Number(mostCommon);
                    reason = `most_common_value (${valueCounts[mostCommon]}/${values.length} instances)`;
                }
                else {
                    // For other fields, use the first valid value
                    resolution = uniqueValues[0];
                    reason = 'first_valid_value';
                }
                conflicts.push({
                    field,
                    values: uniqueValues,
                    sources,
                    resolution,
                    reason
                });
                merged[field] = resolution;
            }
            else if (uniqueValues.length === 1) {
                // No conflict
                merged[field] = uniqueValues[0];
            }
        }
        // Generate fingerprint and calculate confidence for merged property
        merged.fingerprint = this.generateFingerprint(merged);
        const validation = this.validateProperty(merged);
        merged.validationFlags = validation.flags;
        merged.confidence = this.calculateConfidence(merged, validation.flags);
        return {
            address,
            conflicts,
            merged
        };
    }
    /**
     * Normalize a single property
     */
    normalizeProperty(property) {
        const validation = this.validateProperty(property);
        const fingerprint = this.generateFingerprint(property);
        const confidence = this.calculateConfidence(property, validation.flags);
        return {
            ...property,
            fingerprint,
            confidence,
            validationFlags: validation.flags,
            primarySource: property.source || 'unknown'
        };
    }
    /**
     * Process multiple properties, handling duplicates and conflicts
     */
    processProperties(properties) {
        console.log(`🔍 Processing ${properties.length} properties for normalization...`);
        // Group properties by address
        const addressGroups = new Map();
        for (const property of properties) {
            const normalizedAddress = property.address?.toLowerCase().trim();
            if (!normalizedAddress)
                continue;
            if (!addressGroups.has(normalizedAddress)) {
                addressGroups.set(normalizedAddress, []);
            }
            addressGroups.get(normalizedAddress).push(property);
        }
        const normalized = [];
        const conflicts = [];
        // Process each address group
        for (const [address, groupProperties] of addressGroups) {
            if (groupProperties.length === 1) {
                // No duplicates, just normalize
                const normalizedProp = this.normalizeProperty(groupProperties[0]);
                normalized.push(normalizedProp);
            }
            else {
                // Handle duplicates and conflicts
                console.log(`   🔗 Found ${groupProperties.length} instances of ${address}`);
                const conflictResolution = this.resolveConflicts(address, groupProperties);
                conflicts.push(conflictResolution);
                normalized.push(conflictResolution.merged);
                // Log conflicts
                if (conflictResolution.conflicts.length > 0) {
                    console.log(`   ⚠️  Resolved ${conflictResolution.conflicts.length} conflicts for ${address}:`);
                    conflictResolution.conflicts.forEach(conflict => {
                        console.log(`      ${conflict.field}: [${conflict.values.join(', ')}] → ${conflict.resolution} (${conflict.reason})`);
                    });
                }
            }
        }
        // Calculate summary statistics
        const summary = {
            originalCount: properties.length,
            duplicatesFound: properties.length - addressGroups.size,
            conflictsResolved: conflicts.reduce((sum, c) => sum + c.conflicts.length, 0),
            finalCount: normalized.length,
            highConfidence: normalized.filter(p => p.confidence === 'high').length,
            mediumConfidence: normalized.filter(p => p.confidence === 'medium').length,
            lowConfidence: normalized.filter(p => p.confidence === 'low').length
        };
        console.log(`✅ Normalization complete:`);
        console.log(`   📊 ${summary.originalCount} → ${summary.finalCount} properties`);
        console.log(`   🔗 ${summary.duplicatesFound} duplicates merged`);
        console.log(`   ⚠️  ${summary.conflictsResolved} conflicts resolved`);
        console.log(`   📈 Confidence: ${summary.highConfidence}H/${summary.mediumConfidence}M/${summary.lowConfidence}L`);
        return {
            normalized,
            conflicts,
            summary
        };
    }
    /**
     * Get conflict report for debugging
     */
    getConflictReport() {
        return [...this.conflictLog];
    }
    /**
     * Clear internal state
     */
    reset() {
        this.seenProperties.clear();
        this.conflictLog = [];
    }
}
exports.PropertyDataNormalizer = PropertyDataNormalizer;
