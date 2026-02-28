import React from 'react';
import { render } from '@testing-library/react-native';
import { SettingsContext } from '../context/SettingsContext';
import { createMockSettingsContext } from './settingsContextMock';

export function renderWithSettings(
    ui: React.ReactElement,
    contextOverrides: Record<string, unknown> = {}
) {
    const contextValue = { ...createMockSettingsContext(), ...contextOverrides };

    return {
        ...render(
            <SettingsContext.Provider value={contextValue}>
                {ui}
            </SettingsContext.Provider>
        ),
        contextValue,
    };
}
