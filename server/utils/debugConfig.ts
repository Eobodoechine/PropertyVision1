// Debug configuration - enable/disable debugging features
export const DEBUG_CONFIG = {
  // Master debug switch
  enabled: process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development',

  // Component-specific debugging
  components: {
    outlierDetection: process.env.DEBUG_OUTLIERS === 'true',
    arvCalculation: process.env.DEBUG_ARV === 'true',
    comparableSearch: process.env.DEBUG_COMPS === 'true',
    glaFiltering: process.env.DEBUG_GLA === 'true',
    bathroomAdjustments: process.env.DEBUG_BATH === 'true'
  },

  // Output options
  output: {
    console: true,
    file: process.env.DEBUG_FILE || null,
    timestamps: true,
    colors: true
  },

  // Performance tracking
  timing: process.env.DEBUG_TIMING === 'true'
};

// Quick debug helper
export const isDebugEnabled = (component?: keyof typeof DEBUG_CONFIG.components): boolean => {
  if (!DEBUG_CONFIG.enabled) return false;
  if (!component) return true;
  return DEBUG_CONFIG.components[component] || false;
};

// Environment variable examples:
// DEBUG=true npm run dev                    # Enable all debugging
// DEBUG_OUTLIERS=true npm run dev           # Debug outlier detection only
// DEBUG_ARV=true npm run dev               # Debug ARV calculation only
// DEBUG_TIMING=true npm run dev            # Enable performance timing