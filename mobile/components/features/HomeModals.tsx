import React from 'react';
import { Commodity } from '../../types/commodity';
import GridSettingsModal from './GridSettingsModal';
import SortModal from './SortModal';
import SearchModal from './SearchModal';

interface HomeModalsProps {
    data: Commodity[];
    navigation: any;

    isSettingsModalVisible: boolean;
    setSettingsModalVisible: (v: boolean) => void;
    showCategory: boolean;
    setShowCategory: (v: boolean) => void;
    showChangePercent: boolean;
    setShowChangePercent: (v: boolean) => void;
    showChangeAbs: boolean;
    setShowChangeAbs: (v: boolean) => void;
    showDate: boolean;
    setShowDate: (v: boolean) => void;
    showUnit: boolean;
    setShowUnit: (v: boolean) => void;
    fontScale: 'small' | 'medium' | 'large';
    setFontScale: (v: 'small' | 'medium' | 'large') => void;
    density: 'compact' | 'cozy' | 'roomy';
    setDensity: (v: 'compact' | 'cozy' | 'roomy') => void;

    isSortModalVisible: boolean;
    setSortModalVisible: (v: boolean) => void;
    sortMethod: string;
    setSortMethod: (v: string) => void;
    sortOrder: string;
    setSortOrder: (v: string) => void;

    isSearchModalVisible: boolean;
    setSearchModalVisible: (v: boolean) => void;
    searchQuery: string;
    setSearchQuery: (v: string) => void;
}

export default function HomeModals({
    data, navigation,
    isSettingsModalVisible, setSettingsModalVisible,
    showCategory, setShowCategory,
    showChangePercent, setShowChangePercent,
    showChangeAbs, setShowChangeAbs,
    showDate, setShowDate,
    showUnit, setShowUnit,
    fontScale, setFontScale,
    density, setDensity,
    isSortModalVisible, setSortModalVisible,
    sortMethod, setSortMethod,
    sortOrder, setSortOrder,
    isSearchModalVisible, setSearchModalVisible,
    searchQuery, setSearchQuery,
}: HomeModalsProps) {
    return (
        <>
            <GridSettingsModal
                visible={isSettingsModalVisible}
                onClose={() => setSettingsModalVisible(false)}
                showCategory={showCategory} setShowCategory={setShowCategory}
                showChangePercent={showChangePercent} setShowChangePercent={setShowChangePercent}
                showChangeAbs={showChangeAbs} setShowChangeAbs={setShowChangeAbs}
                showDate={showDate} setShowDate={setShowDate}
                showUnit={showUnit} setShowUnit={setShowUnit}
                fontScale={fontScale} setFontScale={setFontScale}
                density={density} setDensity={setDensity}
            />
            <SortModal
                visible={isSortModalVisible}
                onClose={() => setSortModalVisible(false)}
                sortMethod={sortMethod} setSortMethod={setSortMethod}
                sortOrder={sortOrder} setSortOrder={setSortOrder}
            />
            <SearchModal
                visible={isSearchModalVisible}
                onClose={() => setSearchModalVisible(false)}
                data={data}
                navigation={navigation}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
            />
        </>
    );
}
