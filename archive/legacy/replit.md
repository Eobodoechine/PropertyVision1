# PropertyVision Real Estate ARV Analysis Platform

## Overview

PropertyVision is a comprehensive real estate analysis platform that provides After Repair Value (ARV) estimates for properties. The system consists of a Node.js backend API and a React frontend, designed to analyze properties through integration with real estate data APIs. The platform performs automated property valuation using sophisticated comparable sales analysis with geographic boundary searches, filtering, and confidence assessment algorithms.

The application features an intelligent analysis pipeline that starts with precise property location discovery, performs multi-radius comparable sales searches, applies strict filtering criteria for data quality, and calculates ARV estimates using statistical methodologies. The system includes fallback mechanisms for data enrichment through web research when property details are incomplete.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend Architecture

**Framework & Runtime**: Built on Express.js with TypeScript support, utilizing ESM modules for modern JavaScript compatibility. The server supports both development (with Vite integration) and production modes.

**API Design**: RESTful API architecture with a single primary endpoint (`/api/property/analyze`) that accepts address input and returns comprehensive property analysis results. The API uses Zod for request validation and structured error handling.

**Data Processing Pipeline**: 
- **Property Discovery**: Uses address auto-complete APIs for precise coordinate extraction
- **Geographic Search**: Implements boundary-based property searches rather than postal code filtering for comprehensive results
- **Multi-phase Analysis**: Employs conditional search methodology starting with strict filters, then expanding through null-value searches and web research enhancement
- **Statistical Analysis**: Uses sophisticated ARV calculation with IQR outlier removal and upper cluster analysis (≥65th percentile)

**Storage Strategy**: Implements in-memory storage with no persistence, ensuring fresh real-time analysis on every request. This architectural decision prioritizes data freshness over caching for real estate market accuracy.

**Error Handling**: Comprehensive error handling with specific validation for RapidAPI responses, rate limiting awareness, and graceful degradation when external services are unavailable.

### Frontend Architecture

**Framework**: React 18 with TypeScript, using modern hooks-based components and functional programming patterns.

**Routing**: Wouter for lightweight client-side routing with minimal bundle impact.

**State Management**: TanStack Query (React Query) for server state management, providing caching, background updates, and optimistic updates for API interactions.

**UI Framework**: Shadcn/ui components built on Radix UI primitives with Tailwind CSS for styling. This provides accessible, customizable components with consistent design patterns.

**Build System**: Vite for development and production builds, offering fast HMR and optimized bundling.

### Real Estate Analysis Engine

**Property Matching Algorithm**: Implements 20% size variance filtering, 6-month sales recency requirements, and realistic price-per-square-foot validation ($50-$300 range).

**Geographic Intelligence**: Radius-based search starting at 1-mile and expanding only when insufficient comparables are found, ensuring proximity relevance while maintaining data sufficiency.

**Confidence Assessment**: Three-tier confidence system (High/Medium/Low) based on comparable quantity, data quality, and market conditions.

**Data Quality Controls**: Strict filtering eliminates properties with missing critical data, unrealistic pricing, or stale sale dates to ensure analysis accuracy.

## External Dependencies

### Third-party APIs

**RapidAPI Real Estate Service** (`realty-in-us.p.rapidapi.com`): Primary data source for property listings, sales history, and property details. Provides comprehensive real estate data including property characteristics, sale prices, and geographic coordinates.

**Google Maps Geocoding API**: Used for address validation, coordinate extraction, and property location precision. Essential for the geographic boundary search methodology.

### Development and Build Tools

**TypeScript**: Provides type safety across the full stack with shared schema definitions between client and server.

**Vite**: Modern build tool for fast development experience and optimized production builds.

**ESBuild**: Used for server-side TypeScript compilation and bundling.

**Drizzle ORM**: Database toolkit for PostgreSQL integration, though currently the system uses in-memory storage.

### UI and Styling

**Tailwind CSS**: Utility-first CSS framework for responsive design and consistent styling.

**Radix UI**: Accessible component primitives for complex UI patterns like dialogs, dropdowns, and form controls.

**Lucide React**: Icon library providing consistent iconography throughout the application.

### Development Utilities

**Zod**: Runtime type validation for API requests and responses, ensuring data integrity.

**Date-fns**: Date manipulation library for handling property sale date calculations and filtering.

**CORS**: Cross-origin resource sharing configuration for API accessibility.

### Optional Integrations

**Neon Database**: PostgreSQL service integration available through Drizzle configuration, supporting future persistent storage requirements.

**Web Search Enhancement**: Architectural support for external web search API integration to enrich property data when primary sources have missing information.