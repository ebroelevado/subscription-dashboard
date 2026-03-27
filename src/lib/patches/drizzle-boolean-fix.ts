/**
 * Monkey-patch for Drizzle better-sqlite3 driver
 * 
 * Fixes the issue where boolean values are not converted to integers
 * before being passed to SQLite, which only accepts numbers, strings, 
 * bigints, buffers, and null.
 * 
 * This patches the prepareQuery method to convert booleans and Date objects
 * to SQLite-compatible types before passing them to the driver.
 */

// Store original reference
let isPatched = false;

/**
 * Convert boolean values to integers and Date objects to ISO strings
 */
function convertParamsForSQLite(params: any[]): any[] {
  return params.map((p) => {
    if (typeof p === 'boolean') {
      return p ? 1 : 0;
    }
    if (p instanceof Date) {
      return p.toISOString();
    }
    return p;
  });
}

/**
 * Apply the monkey-patch to the Drizzle better-sqlite3 driver
 */
export function applyBooleanFix(): void {
  if (isPatched) {
    return;
  }

  try {
    const drizzleModule = require('drizzle-orm/better-sqlite3');
    
    if (!drizzleModule.BetterSQLiteSession) {
      console.warn('[drizzle-boolean-fix] BetterSQLiteSession not found, skipping patch');
      return;
    }

    const originalPrepareQuery = drizzleModule.BetterSQLiteSession.prototype.prepareQuery;

    drizzleModule.BetterSQLiteSession.prototype.prepareQuery = function patchedPrepareQuery(
      query: any,
      fields: any,
      executeMethod: any,
      isResponseInArrayMode: any,
      customResultMapper: any,
      queryMetadata: any,
      cacheConfig: any
    ) {
      const preparedQuery = originalPrepareQuery.call(
        this, query, fields, executeMethod,
        isResponseInArrayMode, customResultMapper,
        queryMetadata, cacheConfig
      );

      const originalAll = preparedQuery.all.bind(preparedQuery);
      const originalRun = preparedQuery.run.bind(preparedQuery);
      const originalGet = preparedQuery.get.bind(preparedQuery);

      // Patch all method
      preparedQuery.all = function patchedAll(placeholderValues?: Record<string, any>) {
        const { fields, joinsNotNullableMap, stmt, customResultMapper } = preparedQuery;
        const filledParams = fillPlaceholders(query.params, placeholderValues ?? {});
        const convertedParams = convertParamsForSQLite(filledParams);

        if (!fields && !customResultMapper) {
          return stmt.all(...convertedParams);
        }

        const rows = stmt.raw().all(...convertedParams);
        if (customResultMapper) {
          return customResultMapper(rows);
        }
        return rows.map((row: any) => mapResultRow(fields, row, joinsNotNullableMap));
      };

      // Patch run method
      preparedQuery.run = function patchedRun(placeholderValues?: Record<string, any>) {
        const filledParams = fillPlaceholders(query.params, placeholderValues ?? {});
        const convertedParams = convertParamsForSQLite(filledParams);
        return preparedQuery.stmt.run(...convertedParams);
      };

      // Patch get method
      preparedQuery.get = function patchedGet(placeholderValues?: Record<string, any>) {
        const filledParams = fillPlaceholders(query.params, placeholderValues ?? {});
        const convertedParams = convertParamsForSQLite(filledParams);

        const { fields, stmt, joinsNotNullableMap, customResultMapper } = preparedQuery;
        if (!fields && !customResultMapper) {
          return stmt.get(...convertedParams);
        }
        const row = stmt.raw().get(...convertedParams);
        if (!row) {
          return undefined;
        }
        if (customResultMapper) {
          return customResultMapper([row]);
        }
        return mapResultRow(fields, row, joinsNotNullableMap);
      };

      return preparedQuery;
    };

    isPatched = true;
    console.log('[drizzle-boolean-fix] ✓ Applied successfully');
  } catch (error) {
    console.error('[drizzle-boolean-fix] Failed to apply:', error);
  }
}

// Helper function to fill placeholders
function fillPlaceholders(params: any[], values: Record<string, any>): any[] {
  return params.map((p: any) => {
    if (p && typeof p === 'object' && 'name' in p && typeof p.name === 'string') {
      if (!(p.name in values)) {
        throw new Error(`No value for placeholder "${p.name}" was provided`);
      }
      return values[p.name];
    }
    if (p && typeof p === 'object' && 'value' in p && p.value && typeof p.value === 'object' && 'name' in p.value) {
      if (!(p.value.name in values)) {
        throw new Error(`No value for placeholder "${p.value.name}" was provided`);
      }
      if (p.encoder && typeof p.encoder.mapToDriverValue === 'function') {
        return p.encoder.mapToDriverValue(values[p.value.name]);
      }
      return values[p.value.name];
    }
    return p;
  });
}

// Helper function to map result rows
function mapResultRow(fields: any, row: any, joinsNotNullableMap: any): any {
  if (!fields) return row;
  
  const result: any = {};
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const value = row[i];
    
    if (field && field.path) {
      let current = result;
      for (let j = 0; j < field.path.length - 1; j++) {
        const key = field.path[j];
        if (!(key in current)) {
          current[key] = {};
        }
        current = current[key];
      }
      current[field.path[field.path.length - 1]] = value;
    }
  }
  
  return result;
}

// Auto-apply patch when module is imported
applyBooleanFix();
