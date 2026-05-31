'use client'

import { usePathname } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";

import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { deriveBreadcrumbs } from "@/lib/breadcrumbs";
import { H } from "./style/Style";

interface ContentContainerProps {
  children: React.ReactNode,
  title: string,
  description?: string,
  /** Stretch content edge-to-edge instead of the centered readable width. */
  fullWidth?: boolean,
  /** Override labels for unusual/dynamic path segments (e.g. an entity name). */
  segmentLabels?: Record<string, string>,
}

export function ContentContainer({
  children,
  title,
  description,
  fullWidth,
  segmentLabels,
}: ContentContainerProps) {
  const pathname = usePathname()
  const crumbs = deriveBreadcrumbs(pathname, title, segmentLabels)

  return (
    <div className="flex flex-1 flex-col">
      <div className={clsx("w-full px-4 py-6 md:px-6", !fullWidth && "mx-auto max-w-4xl")}>
        <header>
          <Breadcrumb className="mb-3">
            <BreadcrumbList>
              {crumbs.map((crumb, index) => {
                const isLast = index === crumbs.length - 1
                return (
                  <div key={`${crumb.label}-${index}`} className="contents">
                    <BreadcrumbItem>
                      {crumb.href && !isLast ? (
                        <BreadcrumbLink render={<Link href={crumb.href} />}>
                          {crumb.label}
                        </BreadcrumbLink>
                      ) : (
                        <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                    {!isLast && <BreadcrumbSeparator />}
                  </div>
                )
              })}
            </BreadcrumbList>
          </Breadcrumb>

          <H size={1}>{title}</H>
          {description && (
            <div className="mt-2 text-md text-primary/80">{description}</div>
          )}
        </header>

        <Separator className="my-4" />

        <main>{children}</main>
      </div>
    </div>
  )
}
