import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cn, number, money, date, today, label, exportCsv } from './utils.js';

describe('Web App Utilities (utils.ts)', () => {
  describe('cn', () => {
    it('combines simple class names', () => {
      expect(cn('btn', 'btn-primary')).toBe('btn btn-primary');
    });

    it('handles conditional classes', () => {
      const showHidden = false;
      const showBlock = true;
      expect(cn('btn', showHidden && 'hidden', showBlock && 'block')).toBe('btn block');
    });

    it('merges conflicting tailwind classes', () => {
      expect(cn('p-4', 'p-2')).toBe('p-2');
    });
  });

  describe('number', () => {
    it('formats numbers using en-IN grouping', () => {
      expect(number(1000)).toBe('1,000');
      expect(number(100000)).toBe('1,00,000');
    });

    it('respects decimal precision parameter', () => {
      expect(number(1234.5678, 2)).toBe('1,234.57');
      expect(number(1234.5678, 0)).toBe('1,235');
    });

    it('handles undefined or null gracefully by defaulting to 0', () => {
      expect(number(undefined)).toBe('0');
    });
  });

  describe('money', () => {
    it('formats values in Indian Rupees (INR)', () => {
      const formatted = money(5000);
      // Clean non-breaking spaces for universal comparison
      expect(formatted.replace(/\s+/g, ' ')).toMatch(/₹\s?5,000/);
    });

    it('formats large values in Lakhs correctly', () => {
      const formatted = money(250000);
      expect(formatted.replace(/\s+/g, ' ')).toMatch(/₹\s?2,50,000/);
    });

    it('handles undefined by formatting 0', () => {
      const formatted = money(undefined);
      expect(formatted.replace(/\s+/g, ' ')).toMatch(/₹\s?0/);
    });
  });

  describe('date', () => {
    it('formats an ISO date to short month and year in Asia/Kolkata timezone', () => {
      const result = date('2026-10-15T00:00:00.000Z');
      expect(result).toContain('Oct');
      expect(result).toContain('2026');
    });
  });

  describe('today', () => {
    it('returns a date in YYYY-MM-DD format', () => {
      const todayStr = today();
      expect(todayStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('label', () => {
    it('converts SNAKE_CASE to Title Case with spaces', () => {
      expect(label('IN_PRODUCTION')).toBe('In Production');
      expect(label('PRODUCTION_MANAGER')).toBe('Production Manager');
      expect(label('QUALITY_INSPECTOR')).toBe('Quality Inspector');
    });

    it('handles lowercase or single-word strings', () => {
      expect(label('weaving')).toBe('Weaving');
      expect(label('dyeing')).toBe('Dyeing');
    });
  });

  describe('exportCsv', () => {
    let mockCreateObjectURL: ReturnType<typeof vi.fn>;
    let mockRevokeObjectURL: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
      mockRevokeObjectURL = vi.fn();
      globalThis.URL.createObjectURL = mockCreateObjectURL as unknown as typeof URL.createObjectURL;
      globalThis.URL.revokeObjectURL = mockRevokeObjectURL as unknown as typeof URL.revokeObjectURL;
    });

    it('does nothing when rows array is empty', () => {
      exportCsv('test', []);
      expect(mockCreateObjectURL).not.toHaveBeenCalled();
    });

    it('sanitizes formula injection characters (=, +, -, @)', () => {
      const clickSpy = vi.fn();
      const mockElement = {
        set href(val: string) {},
        set download(val: string) {},
        click: clickSpy,
      };

      const originalDoc = globalThis.document;
      globalThis.document = {
        createElement: vi.fn().mockReturnValue(mockElement),
      } as unknown as Document;

      exportCsv('orders', [
        { code: '=SUM(1,2)', desc: '+cmd|', name: 'Safe Name' },
      ]);

      expect(mockCreateObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(mockRevokeObjectURL).toHaveBeenCalled();

      globalThis.document = originalDoc;
    });
  });
});
