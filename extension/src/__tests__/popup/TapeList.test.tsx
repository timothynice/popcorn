import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { TapeList } from '../../popup/components/TapeList';
import type { TapeRecord } from '@popcorn/shared';

const mockTapes: TapeRecord[] = [
  {
    id: 'tape_001',
    demoName: 'Login Flow',
    testPlanId: 'login-test',
    passed: true,
    steps: [
      {
        stepNumber: 1,
        action: 'navigate',
        description: 'Navigate to login page',
        passed: true,
        duration: 245,
        timestamp: Date.now(),
      },
    ],
    summary: 'Successfully completed login flow.',
    videoMetadata: null,
    screenshots: [],
    duration: 922,
    timestamp: Date.now() - 120000,
  },
  {
    id: 'tape_002',
    demoName: 'Shopping Cart',
    testPlanId: 'cart-test',
    passed: false,
    steps: [
      {
        stepNumber: 1,
        action: 'click',
        description: 'Click add to cart',
        passed: false,
        duration: 156,
        error: 'Button not found',
        timestamp: Date.now(),
      },
    ],
    summary: 'Cart test failed.',
    videoMetadata: null,
    screenshots: [],
    duration: 557,
    timestamp: Date.now() - 60000,
  },
];

describe('TapeList', () => {
  it('renders tape cards from mock data', () => {
    const onSelectTape = vi.fn();
    render(
      <TapeList
        tapes={mockTapes}
        isLoading={false}
        error={null}
        selectedTapeId={null}
        onSelectTape={onSelectTape}
      />,
    );

    expect(screen.getByText('Login Flow')).toBeInTheDocument();
    expect(screen.getByText('Shopping Cart')).toBeInTheDocument();
  });

  it('shows "No tapes yet" when empty', () => {
    const onSelectTape = vi.fn();
    render(
      <TapeList
        tapes={[]}
        isLoading={false}
        error={null}
        selectedTapeId={null}
        onSelectTape={onSelectTape}
      />,
    );

    expect(screen.getByText('No tapes yet.')).toBeInTheDocument();
    expect(
      screen.getByText('Modify a frontend file to trigger a demo.'),
    ).toBeInTheDocument();
  });

  it('shows loading state', () => {
    const onSelectTape = vi.fn();
    render(
      <TapeList
        tapes={[]}
        isLoading={true}
        error={null}
        selectedTapeId={null}
        onSelectTape={onSelectTape}
      />,
    );

    expect(screen.getByText('Loading tapes...')).toBeInTheDocument();
  });

  it('clicking a tape calls selectTape', async () => {
    const user = userEvent.setup();
    const onSelectTape = vi.fn();
    render(
      <TapeList
        tapes={mockTapes}
        isLoading={false}
        error={null}
        selectedTapeId={null}
        onSelectTape={onSelectTape}
      />,
    );

    const loginTape = screen.getByText('Login Flow');
    await user.click(loginTape);

    expect(onSelectTape).toHaveBeenCalledWith('tape_001');
  });

  it('shows error state', () => {
    const onSelectTape = vi.fn();
    render(
      <TapeList
        tapes={[]}
        isLoading={false}
        error="Failed to load tapes"
        selectedTapeId={null}
        onSelectTape={onSelectTape}
      />,
    );

    expect(screen.getByText('Failed to load tapes')).toBeInTheDocument();
  });
});
