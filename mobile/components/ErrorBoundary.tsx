import React, { Component, ReactNode } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('ErrorBoundary caught:', error, info.componentStack);
    }

    reset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback;

            return (
                <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900">
                    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}>
                        <Text className="text-4xl text-center mb-4">⚠️</Text>
                        <Text className="text-xl font-bold text-slate-900 dark:text-white text-center mb-2">
                            Something went wrong
                        </Text>
                        <Text className="text-sm text-slate-500 dark:text-slate-400 text-center mb-6">
                            An unexpected error occurred. Please try again.
                        </Text>
                        {__DEV__ && this.state.error && (
                            <View className="bg-rose-50 dark:bg-rose-900/20 rounded-xl p-4 mb-6 border border-rose-200 dark:border-rose-800">
                                <Text className="text-xs font-mono text-rose-700 dark:text-rose-400">
                                    {this.state.error.toString()}
                                </Text>
                            </View>
                        )}
                        <TouchableOpacity
                            onPress={this.reset}
                            className="bg-blue-500 py-3 px-6 rounded-xl items-center"
                        >
                            <Text className="text-white font-bold text-base">Try Again</Text>
                        </TouchableOpacity>
                    </ScrollView>
                </SafeAreaView>
            );
        }

        return this.props.children;
    }
}
