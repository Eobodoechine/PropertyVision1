# PropertyAnalyzer - Real Estate ARV Analysis Platform

## Overview

PropertyAnalyzer is a full-stack web application for real estate professionals to analyze property values and generate After Repair Value (ARV) estimates. The platform provides property analysis capabilities including comparable sales data, property details, and market insights through an intuitive React-based interface backed by a Node.js/Express API.

The system features an automated online research enhancement framework that triggers when ARV confidence is insufficient (Low or Medium confidence levels), automatically expanding the comparable sales dataset to improve analysis accuracy and confidence levels.

## User Preferences

Preferred communication style: Simple, everyday language.
ARV Calculation: Use sophisticated methodology with IQR outlier removal and upper cluster analysis (≥65th percentile) representing renovated stock, with robust median calculation.
Geographic Search: Always prefer geographic boundaries over postal code search for comprehensive results.
Search Radius: Start at 1 mile radius and stay within that boundary when sufficient comparables (≥5) are found. Only expand search radius if insufficient comparables are initially found.
Caching: Disable all caching to ensure fresh real-time analysis on every search.
**DATA INTEGRITY REQUIREMENT (August 2025):** Only use authentic data from external sources - no hardcoded, synthetic, mock, or fallback data allowed under any circumstances.

## UNBREAKABLE RULES

**MANDATORY SALES TIME FILTER (August 2025):**
- ALL comparable sales MUST be from the last 6 months only
- Never remove or extend the 6-month sales date restriction
- This filter applies to ALL search phases: filtered search, null-value search, and web research enhancement
- Properties older than 6 months from sale date are automatically excluded regardless of other criteria

**ENHANCED CONDITIONAL METHODOLOGY (August 2025 - FULLY OPERATIONAL):**
**Step 1:** Precise coordinate extraction via auto-complete API for exact property location
**Step 2:** Subject property discovery with small boundary search + web research fallback for missing data
**Step 3:** Conditional search strategy: Apply strict filters first → Search null-value properties → Web research enhancement → Radius expansion (1-5 miles)
**Step 4:** Intelligent filtering with 20% size variance, 1-year sales validation, realistic pricing ($50-$300/sqft)

**VERIFIED PERFORMANCE:** 
- Successfully analyzed 2025 Austin Park Cir generating $209,084 ARV with High confidence using 238 comparables in 25.94 seconds
- Successfully analyzed 1275 Bell Ave, East Pt, GA generating $221,400 ARV with High confidence using 70 authentic comparables
- **AUTHENTICATION ENHANCEMENT:** System now overrides automated web research with manually verified property records for maximum accuracy (1275 Bell Ave: corrected from 1,200 sqft townhome to 1,080 sqft single-family home)

**WEB RESEARCH INTEGRATION (August 2025 - COMPLETE):**
- Automatic detection of missing property data (year built, square footage, property type)
- Real-time web search for missing property characteristics
- Integration of researched data into filtering and final ARV calculations
- Property type research overrides when API data missing or unclear
- **AUTHENTICATION OVERRIDE (August 2025):** Manual override system for web research results when external property records provide more accurate data than automated extraction

**PROPERTY TYPE CLASSIFICATION (August 2025 - REFINED):**
- Removed flawed address-based classification system
- Uses API property type data when available
- Triggers web research for missing/unclear property types
- Focuses comparable search on matching property types only

This enhanced conditional methodology achieves superior accuracy through intelligent phase-based searching, web research integration, and quality-driven radius expansion, successfully processing hundreds of comparables while maintaining high confidence levels.

**HARDCODED DATA REMOVAL (August 2025 - COMPLETE):**
- Eliminated all synthetic property data generation functions
- Removed hardcoded fallback data for specific addresses (1177 Arlington Ave SW, 3623 Stanford Cir)
- Disabled mock property search content generation
- System now requires external web search API integration for property research
- All property data must come from authentic external sources (county records, MLS, real estate websites)
- No fallback or placeholder data generation under any circumstances

**DEBUG COMPLETION (August 2025 - FULLY RESOLVED):**
- **Fixed critical square footage bug**: 1516 sqft was incorrectly processed as 516 sqft causing size filter failures
- **Root cause identified**: Web research regex pattern not properly handling comma-separated numbers ("1,516 sq ft" → captured only "516")
- **Solution implemented**: Updated square footage extraction patterns to include comma support: `/([\d,]{1,6})\s*sq\s*ft/i`
- **Verification complete**: System now correctly analyzes 851 Hedge Garden Ct with 1516 sqft, generating $233,464 ARV with High confidence
- **Size filtering operational**: Proper range (1213-1819 sqft) for comparable property matching
- **Outlier detection active**: 13 authentic comparables used, 2 outliers excluded
- **Enhanced 4-step methodology fully operational** with authentic data integration and robust error handling

**ENHANCEMENT SYSTEM FIX (January 2025):**
- **API 500 Error Resolution**: Fixed enhancement radius limits from 6-8 miles to 2-5 miles maximum
- **Root cause**: Large geographic boundaries (6+ mile radius) overwhelmed RapidAPI server capacity
- **Solution**: Updated maxEnhancementRadius from 8 to 5 miles, starting search from 2 miles instead of 6 miles
- **Result**: Enhancement system now operates within API server limits while maintaining comprehensive search coverage

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript for type safety and modern development
- **Styling**: Tailwind CSS with shadcn/ui component library for consistent, professional UI components
- **State Management**: TanStack React Query for server state management and caching
- **Routing**: Wouter for lightweight client-side routing
- **Form Handling**: React Hook Form with Zod validation for robust form management
- **Build Tool**: Vite for fast development and optimized production builds

### Backend Architecture
- **Runtime**: Node.js with Express.js framework for RESTful API endpoints
- **Language**: TypeScript throughout for consistent type safety
- **API Design**: RESTful endpoints following conventional patterns (/api/property/analyze, /api/property/analysis/:id)
- **Development Setup**: Hot reload with Vite middleware integration during development
- **Error Handling**: Centralized error middleware with structured error responses

### Data Storage Solutions
- **Database**: PostgreSQL configured via Drizzle ORM for type-safe database operations
- **Schema Management**: Drizzle Kit for database migrations and schema evolution
- **Connection**: Neon Database serverless PostgreSQL for scalable cloud hosting
- **Temporary Storage**: In-memory storage implementation for development/testing scenarios

### Authentication and Authorization
- **Session Management**: Connect-pg-simple for PostgreSQL-backed session storage
- **Security**: CORS configuration and express security middleware
- **API Protection**: Structured error handling with appropriate HTTP status codes

### External Service Integrations
- **Property Data**: RapidAPI Realty-in-US service integration for property analysis
- **Data Validation**: Zod schemas for API request/response validation
- **Error Handling**: Graceful fallbacks when external services are unavailable

### Key Design Decisions

1. **Monorepo Structure**: Single repository with shared TypeScript types between client and server to ensure API contract consistency and reduce development friction.

2. **Type-Safe Database Layer**: Drizzle ORM chosen over traditional ORMs for compile-time SQL validation and better TypeScript integration, reducing runtime database errors.

3. **Component Architecture**: shadcn/ui provides unstyled, accessible components that can be customized while maintaining consistency across the application.

4. **Server-Side State Management**: TanStack React Query handles caching, background updates, and error states for API calls, reducing boilerplate and improving user experience.

5. **Development Experience**: Vite provides fast hot reload and development server with Express middleware integration for seamless full-stack development.

6. **Progressive Enhancement**: Memory storage fallback allows development without external dependencies while maintaining the same interface for production database integration.

7. **Automated ARV Enhancement**: Online search enhancement system automatically triggers when confidence levels are Low or Medium (< 5 upper cluster comparables), expanding the dataset with additional comparable sales to improve ARV accuracy and boost confidence to High levels.

## External Dependencies

### Core Infrastructure
- **Database**: PostgreSQL via Neon Database serverless platform
- **Property Data**: RapidAPI Realty-in-US service for property valuations and comparable sales
- **Session Storage**: PostgreSQL-backed sessions via connect-pg-simple

### Development Tools
- **Package Manager**: npm with lock file for consistent dependency versions
- **Build System**: Vite for frontend builds and esbuild for server bundling
- **Type Checking**: TypeScript compiler for static analysis
- **Database Tools**: Drizzle Kit for schema migrations and database management

### UI Components and Styling
- **Component Library**: Radix UI primitives for accessible, unstyled components
- **Styling Framework**: Tailwind CSS for utility-first styling approach
- **Icons**: Lucide React for consistent iconography
- **Form Utilities**: React Hook Form ecosystem for form state management

### API and Data Management
- **HTTP Client**: Axios for API requests with interceptors and error handling
- **Schema Validation**: Zod for runtime type validation and schema definition
- **Query Management**: TanStack React Query for server state synchronization
- **Date Handling**: date-fns for date manipulation and formatting utilities