import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CriteriaEditor } from '../../popup/components/CriteriaEditor';
import { PresetSelector } from '../../popup/components/PresetSelector';

describe('CriteriaEditor', () => {
  it('renders criteria list', () => {
    const criteria = ['Criterion 1', 'Criterion 2', 'Criterion 3'];
    const onChange = vi.fn();

    render(<CriteriaEditor criteria={criteria} onChange={onChange} />);

    expect(screen.getByDisplayValue('Criterion 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Criterion 2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Criterion 3')).toBeInTheDocument();
  });

  it('shows empty state when no criteria', () => {
    const onChange = vi.fn();

    render(<CriteriaEditor criteria={[]} onChange={onChange} />);

    expect(screen.getByText('No criteria defined yet.')).toBeInTheDocument();
    expect(screen.getByText('Add criteria to define what should be tested.')).toBeInTheDocument();
  });

  it('adds a new criterion when add button is clicked', () => {
    const criteria = ['Existing criterion'];
    const onChange = vi.fn();

    render(<CriteriaEditor criteria={criteria} onChange={onChange} />);

    const addButton = screen.getByText('+ Add criterion');
    fireEvent.click(addButton);

    expect(onChange).toHaveBeenCalledWith(['Existing criterion', '']);
  });

  it('removes a criterion when remove button is clicked', () => {
    const criteria = ['Criterion 1', 'Criterion 2', 'Criterion 3'];
    const onChange = vi.fn();

    render(<CriteriaEditor criteria={criteria} onChange={onChange} />);

    const removeButtons = screen.getAllByLabelText('Remove criterion');
    fireEvent.click(removeButtons[1]);

    expect(onChange).toHaveBeenCalledWith(['Criterion 1', 'Criterion 3']);
  });

  it('updates a criterion when input changes', () => {
    const criteria = ['Original text'];
    const onChange = vi.fn();

    render(<CriteriaEditor criteria={criteria} onChange={onChange} />);

    const input = screen.getByDisplayValue('Original text');
    fireEvent.change(input, { target: { value: 'Updated text' } });

    expect(onChange).toHaveBeenCalledWith(['Updated text']);
  });

  it('hides edit controls in readOnly mode', () => {
    const criteria = ['Criterion 1', 'Criterion 2'];
    const onChange = vi.fn();

    render(<CriteriaEditor criteria={criteria} onChange={onChange} readOnly />);

    expect(screen.queryByLabelText('Remove criterion')).not.toBeInTheDocument();
    expect(screen.queryByText('+ Add criterion')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    expect(screen.getByText('Criterion 1')).toBeInTheDocument();
    expect(screen.getByText('Criterion 2')).toBeInTheDocument();
  });

  it('displays criteria as text in readOnly mode', () => {
    const criteria = ['Read-only criterion'];
    const onChange = vi.fn();

    render(<CriteriaEditor criteria={criteria} onChange={onChange} readOnly />);

    expect(screen.getByText('Read-only criterion')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Read-only criterion')).not.toBeInTheDocument();
  });
});

describe('PresetSelector', () => {
  it('renders preset dropdown', () => {
    const onSelect = vi.fn();

    render(<PresetSelector onSelect={onSelect} />);

    expect(screen.getByLabelText('Preset')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders all preset options', () => {
    const onSelect = vi.fn();

    render(<PresetSelector onSelect={onSelect} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const options = Array.from(select.options).map((opt) => opt.text);

    expect(options).toContain('Forms');
    expect(options).toContain('Navigation');
    expect(options).toContain('Authentication');
    expect(options).toContain('Custom');
  });

  it('calls onSelect with forms criteria when Forms preset is selected', () => {
    const onSelect = vi.fn();

    render(<PresetSelector onSelect={onSelect} />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'forms' } });

    expect(onSelect).toHaveBeenCalledWith([
      'All form inputs have associated labels',
      'Required fields show validation when left empty',
      'Form submits successfully with valid data',
      'Success message displays after valid submission',
      'Error messages display for invalid inputs',
    ]);
  });

  it('calls onSelect with navigation criteria when Navigation preset is selected', () => {
    const onSelect = vi.fn();

    render(<PresetSelector onSelect={onSelect} />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'navigation' } });

    expect(onSelect).toHaveBeenCalledWith([
      'All navigation links resolve to valid pages',
      'No 404 or error pages encountered during navigation',
      'Breadcrumbs reflect the current page correctly',
      'Page transitions complete without errors',
    ]);
  });

  it('calls onSelect with authentication criteria when Authentication preset is selected', () => {
    const onSelect = vi.fn();

    render(<PresetSelector onSelect={onSelect} />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'authentication' } });

    expect(onSelect).toHaveBeenCalledWith([
      'Login succeeds with valid credentials and redirects correctly',
      'Session persists when navigating between pages',
      'Logout clears the session and redirects to login',
      'Error message shown for invalid login credentials',
      'Protected pages redirect unauthenticated users to login',
    ]);
  });

  it('calls onSelect with empty array when Custom preset is selected', () => {
    const onSelect = vi.fn();

    render(<PresetSelector onSelect={onSelect} />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'custom' } });

    expect(onSelect).toHaveBeenCalledWith([]);
  });
});
