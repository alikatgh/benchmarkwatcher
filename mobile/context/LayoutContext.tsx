import React, { createContext, useContext, useState, useEffect } from 'react';
import { Dimensions, ScaledSize, Platform } from 'react-native';
import { useSafeAreaInsets, EdgeInsets } from 'react-native-safe-area-context';

interface LayoutState {
    dvh: number;
    deviceType: 'mobile' | 'tablet';
    safeAreas: EdgeInsets;
}

const defaultInsets: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export const LayoutContext = createContext<LayoutState>({
    dvh: Dimensions.get('window').height * 0.01,
    deviceType: 'mobile',
    safeAreas: defaultInsets,
});

export const useLayout = () => useContext(LayoutContext);

export const LayoutProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const insets = useSafeAreaInsets();

    const [dvh, setDvh] = useState(Dimensions.get('window').height * 0.01);
    const [deviceType, setDeviceType] = useState<'mobile' | 'tablet'>(
        Dimensions.get('window').width >= 768 ? 'tablet' : 'mobile'
    );

    useEffect(() => {
        const onChange = ({ window }: { window: ScaledSize }) => {
            setDvh(window.height * 0.01);
            setDeviceType(window.width >= 768 ? 'tablet' : 'mobile');
        };

        const subscription = Dimensions.addEventListener('change', onChange);

        return () => subscription.remove();
    }, []);

    return (
        <LayoutContext.Provider value={{ dvh, deviceType, safeAreas: insets }}>
            {children}
        </LayoutContext.Provider>
    );
};
