'use client';

import { useDocsSearch } from 'fumadocs-core/search/client';
import { staticClient } from 'fumadocs-core/search/client/orama-static';
import {
  SearchDialog, SearchDialogClose, SearchDialogContent, SearchDialogHeader,
  SearchDialogIcon, SearchDialogInput, SearchDialogList, SearchDialogOverlay,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search';
import { Alert } from '@bloxwap/hig-react/status';
import { assetUrl } from '@/lib/site';

/** No-results state in HIG copy and geometry; the static index never needs a network retry. */
function NoResults() {
  return <div className="search-state" role="status">
    <strong>No matching pages</strong>
    <p>Try a sound name such as <code>success</code>, an API such as <code>bind</code>, or browse the <a className="hig-link" href={assetUrl('/sitemap.xml')}>sitemap</a>.</p>
  </div>;
}

export default function StaticSearch(props: SharedProps) {
  const { search, setSearch, query } = useDocsSearch({
    client: staticClient({ from: assetUrl('/search.json') }),
  });
  return (
    <SearchDialog search={search} onSearchChange={setSearch} isLoading={query.isLoading} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader><SearchDialogIcon /><SearchDialogInput /><SearchDialogClose /></SearchDialogHeader>
        {query.error
          ? <div className="search-state">
            <Alert title="Search is unavailable" severity="error">
              <p>The search index could not be loaded. Use the sidebar, or open <a className="hig-link" href={assetUrl('/llms.txt')}>llms.txt</a> for a plain list of pages.</p>
            </Alert>
          </div>
          : <SearchDialogList items={query.data === 'empty' ? null : query.data} Empty={NoResults} />}
      </SearchDialogContent>
    </SearchDialog>
  );
}
