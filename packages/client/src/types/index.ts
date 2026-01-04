export * from './database';

export type NavigationItem = {
  id: string;
  name: string;
  icon: string;
  path: string;
};

export type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export interface ProviderWithModels extends import('./database').Provider {
  models?: import('./database').Model[];
}
