import React, { useState } from 'react';
import { Award, Layers, Lock } from 'lucide-react';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { useAuth } from '../../hooks/useAuth';
import { hasUserPermission } from '../../utils/portalConfig';
import { DesignationManagementPage } from '../shared/DesignationManagementPage';
import { ServiceManagementPage } from '../shared/ServiceManagementPage';

export const ServiceAndDesignationPage: React.FC = () => {
  const { user } = useAuth();

  const canViewServices = hasUserPermission(user, 'service.view');
  const canViewDesignations = hasUserPermission(user, 'designation.view');

  const [activeTab, setActiveTab] = useState<'services' | 'designations'>(() =>
    canViewServices ? 'services' : 'designations'
  );

  if (!canViewServices && !canViewDesignations) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            Service &amp; Designation Directory
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Access to Master Services and Designations is governed by granular HR permissions.
          </p>
        </div>
        <EmptyStatePanel
          icon={Lock}
          title="Permission Required (service.view / designation.view)"
          description="Your HR account does not currently hold service.view or designation.view permissions. Contact an Administrator if your role requires catalog access."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            Service &amp; Designation Master Catalog
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Authorized REXON Security, Housekeeping, and Manpower services and competency
            designations for Site deployment configuration.
          </p>
        </div>

        <div
          className="inline-flex items-center gap-1 p-1 bg-[#F3EDE4] border border-[#E5DDD2] rounded-xl self-start sm:self-auto"
          role="tablist"
          aria-label="Service and Designation views"
        >
          {canViewServices && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'services'}
              onClick={() => setActiveTab('services')}
              className={`min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap ${
                activeTab === 'services'
                  ? 'bg-[#5C3D2E] text-white'
                  : 'text-[#574B43] hover:text-[#1F1916]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Authorized Services</span>
            </button>
          )}

          {canViewDesignations && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'designations'}
              onClick={() => setActiveTab('designations')}
              className={`min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap ${
                activeTab === 'designations'
                  ? 'bg-[#5C3D2E] text-white'
                  : 'text-[#574B43] hover:text-[#1F1916]'
              }`}
            >
              <Award className="w-3.5 h-3.5" />
              <span>Authorized Designations</span>
            </button>
          )}
        </div>
      </div>

      {activeTab === 'services' && canViewServices ? (
        <ServiceManagementPage embedded />
      ) : (
        <DesignationManagementPage embedded />
      )}
    </div>
  );
};
