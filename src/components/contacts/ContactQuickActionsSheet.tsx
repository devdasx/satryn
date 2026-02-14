/**
 * ContactQuickActionsSheet
 * Long-press menu for the contacts list.
 */

import React from 'react';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { SheetOptionRow } from '../ui/SheetComponents';
import type { Contact } from '../../types/contacts';

export interface ContactQuickActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  contact: Contact | null;
  onAction: (action: string) => void;
}

export function ContactQuickActionsSheet({
  visible,
  onClose,
  contact,
  onAction,
}: ContactQuickActionsSheetProps) {
  if (!contact) return null;

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title={contact.name}
      sizing="auto"
    >
      <SheetOptionRow
        icon="send-outline"
        label="Send Bitcoin"
        description="Send to this contact"
        onPress={() => onAction('send')}
      />
      <SheetOptionRow
        icon="person-outline"
        label="View Details"
        onPress={() => onAction('view')}
        showChevron
      />
      <SheetOptionRow
        icon="copy-outline"
        label="Copy Address"
        description="Copy default address to clipboard"
        onPress={() => onAction('copy')}
      />
      <SheetOptionRow
        icon={contact.isFavorite ? 'star' : 'star-outline'}
        label={contact.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
        onPress={() => onAction('favorite')}
      />
      <SheetOptionRow
        icon="trash-outline"
        label="Delete Contact"
        danger
        onPress={() => onAction('delete')}
        showDivider={false}
      />
    </AppBottomSheet>
  );
}
